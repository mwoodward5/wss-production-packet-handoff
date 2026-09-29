"use strict";

/**
 * SOCIAL / TRUST PROFILE DISCOVERY — "the stuff they didn't know they had".
 *
 * Given a business's own website (and its HTML), find the social and trust
 * profiles THEY OWN, so the mirror can stack them under the hero as
 * recognisable, clickable logos.
 *
 * THE ONLY RULE THAT MATTERS IS OWNERSHIP.
 *
 * We shipped Mastercool's badge and Google Blogger's mark as a client's own
 * identity once already (see the manufacturer-badge post-mortem); attaching a
 * stranger's Facebook page to a plumber is the same failure wearing a new
 * costume, and it is worse, because a social link invites the visitor to go
 * somewhere that is not the client. So a profile is attached on exactly two
 * grounds, and nothing else:
 *
 *   own_site_link — the URL is linked FROM a page on their own domain. A
 *                   business that puts a Facebook link in its own footer has
 *                   asserted ownership itself. This is self-evident and needs
 *                   no further test.
 *
 *   named_match   — the URL came back from a web search and the profile's own
 *                   handle or title contains EVERY distinctive token of the
 *                   business name. "carters-my-plumber" for Carter's My
 *                   Plumber is unambiguous; "indyplumbing" for it is not, and
 *                   is refused. Ambiguity resolves to ABSENT, always.
 *
 * A network we cannot prove is simply not rendered. Per the owner: "If they
 * don't have Google reviews, they get it - they don't have Google reviews."
 * A missing signal is an absent chip, never an invention and never a blocker.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A SECOND HALF TO THIS FILE: WE SHIPPED LINKS TO COMPETITORS.
 * ---------------------------------------------------------------------------
 *
 * Ownership-by-name was checked against a haystack that included the SEARCH
 * RESULT TITLE. That one decision produced every defect measured on the live
 * fleet, because a title is written by the directory, not by the business:
 *
 *   - Plumbers Green Bay got an "Angi" chip pointing at
 *     angi.com/companylist/us/wi/green-bay/plumbing.htm — a CATEGORY PAGE. Its
 *     title is "Top 10 Best Plumbers in Green Bay, WI", which contains every
 *     distinctive token of "Plumbers Green Bay" ([green, bay]). We put a link
 *     to a ranked list of his competitors on his own pitch.
 *
 *   - Poor John's Plumbing got a "LinkedIn" chip pointing at
 *     linkedin.com/in/terri-welker-64822a20, titled "Terri Welker - Owner at
 *     Poor John's Plumbing, LLC". A LinkedIn PERSON page always carries its
 *     employer in the title, so every business with an employee on LinkedIn
 *     could adopt that employee's private page as its company profile.
 *
 *   - Rescue Rooter (Portland OR) got "Yelp" → an Austin TX listing and "BBB" →
 *     a Memphis TN one. Worse, the BBB handle was literally "customer-reviews",
 *     because the URL ended in a tab segment and the last path segment was read
 *     as the business slug; the title carried the name and waved it through.
 *
 * So the second half of this file enforces three things the first half cannot:
 *
 *   1. STRUCTURE. A directory INDEX is not a profile, whatever its title says.
 *      Angi listing URLs carry a numeric listing id; category pages do not.
 *      BBB tab segments (/customer-reviews, /complaints) are stripped so a chip
 *      can never open the client's own complaints tab.
 *
 *   2. FOLLOW THE LINK. We fetch the candidate and read what the DESTINATION
 *      says it is. A URL shape test is what let the competitor list through.
 *      Where the destination is readable it is the highest evidence there is —
 *      it is how Carter's opaque YouTube channel id (UCDoJnM4...) is proved to
 *      be theirs, and how nextdoor.com/pages/samuel-platero-san-jose-ca is
 *      proved to be Platero Parada Plumbing of Sacramento despite a slug that
 *      reads like a stranger in another city.
 *
 *   3. WHEN THE DOOR IS SHUT, DON'T GUESS. Yelp, BBB and Angi answer a server
 *      fetch with 403, LinkedIn member pages with 999, Facebook with 400. A URL
 *      we cannot read ships only if its PATH unambiguously encodes THIS
 *      business, and never over a locality contradiction we can prove.
 *
 * Every one of those rules is contradiction-driven: it needs positive evidence
 * to refuse. Absent evidence keeps the chip when the business linked it itself,
 * and drops it when a search engine guessed it — which is the owner's rule that
 * a missing signal is never a blocker, applied to ownership.
 *
 * This module is pure except for `discoverSocials`, which takes its search AND
 * its link-following fetch by injection, so every ownership decision is
 * testable offline.
 */

// ---------------------------------------------------------------------------
// The network table.
//
// `profile` decides whether a PATH names a profile at all. This is the half
// that stops us linking a client to facebook.com/sharer.php, a Yelp search
// results page, or somebody else's Instagram post that happens to tag them.
// ---------------------------------------------------------------------------

/** Path segments that are never a business profile on any network. */
const NEVER_A_PROFILE = new Set([
  "share", "sharer", "sharer.php", "share.php", "dialog", "plugins", "tr",
  "login", "login.php", "signup", "help", "about", "privacy", "policy", "terms",
  "legal", "settings", "search", "explore", "home", "intent", "hashtag",
  "directory", "topic", "developers", "business", "ads", "advertising",
  "watch", "embed", "results", "feed", "p", "reel", "reels", "stories",
  "accounts", "oauth", "connect", "widgets", "badge", "recommend", "l.php",
  "events", "groups", "marketplace", "gaming", "photo", "photos", "video",
  "media", "jobs", "pulse", "showcase", "learning", "shareArticle", "sharing",
  "user_details", "writeareview", "not_recommended_reviews", "map", "biz_photos",
]);

/** A handle that is only ever a platform surface, never a business. */
function isPlatformHandle(handle) {
  const h = String(handle || "").toLowerCase().replace(/\.(php|html?)$/, "");
  return !h || NEVER_A_PROFILE.has(h);
}

const NETWORKS = Object.freeze([
  {
    key: "facebook",
    label: "Facebook",
    host: /(?:^|\.)facebook\.com$|(?:^|\.)fb\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      // /profile.php?id=123 is a real, if ugly, page identity.
      if (segs[0] === "profile.php" && /^\d{5,}$/.test(u.searchParams.get("id") || "")) {
        return { handle: `profile.php?id=${u.searchParams.get("id")}`, canonical: `https://www.facebook.com/profile.php?id=${u.searchParams.get("id")}` };
      }
      // /pages/Name/123456 and /people/Name/123456 carry the name in seg 1.
      if ((segs[0] === "pages" || segs[0] === "people") && segs[1]) {
        return { handle: segs[1], canonical: `https://www.facebook.com/${segs.slice(0, 3).join("/")}` };
      }
      if (segs.length !== 1 || isPlatformHandle(segs[0])) return null;
      return { handle: segs[0], canonical: `https://www.facebook.com/${segs[0]}` };
    },
  },
  {
    key: "instagram",
    label: "Instagram",
    host: /(?:^|\.)instagram\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      if (segs.length !== 1 || isPlatformHandle(segs[0])) return null;
      return { handle: segs[0], canonical: `https://www.instagram.com/${segs[0]}/` };
    },
  },
  {
    key: "youtube",
    label: "YouTube",
    host: /(?:^|\.)youtube\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      if (segs[0] && segs[0].startsWith("@") && segs[0].length > 1) {
        return { handle: segs[0].slice(1), canonical: `https://www.youtube.com/${segs[0]}` };
      }
      if ((segs[0] === "channel" || segs[0] === "c" || segs[0] === "user") && segs[1] && !isPlatformHandle(segs[1])) {
        return { handle: segs[1], canonical: `https://www.youtube.com/${segs[0]}/${segs[1]}` };
      }
      return null;
    },
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    host: /(?:^|\.)linkedin\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      const i = segs[0] === "company" || segs[0] === "in" ? 0 : (segs[1] === "company" || segs[1] === "in" ? 1 : -1);
      if (i < 0 || !segs[i + 1] || isPlatformHandle(segs[i + 1])) return null;
      // /in/ is a MEMBER page. That is not a heuristic about the slug, it is
      // LinkedIn's own URL contract: /company/ is the business, /in/ is a
      // human being. Carried through so the ownership pass can hold a member
      // page to a stricter test than a company page — see PERSONAL_SURFACE.
      return { handle: segs[i + 1], canonical: `https://www.linkedin.com/${segs[i]}/${segs[i + 1]}`, personalSurface: segs[i] === "in" };
    },
  },
  {
    key: "tiktok",
    label: "TikTok",
    host: /(?:^|\.)tiktok\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      if (!segs[0] || !segs[0].startsWith("@") || segs.length !== 1) return null;
      return { handle: segs[0].slice(1), canonical: `https://www.tiktok.com/${segs[0]}` };
    },
  },
  {
    key: "yelp",
    label: "Yelp",
    host: /(?:^|\.)yelp\.com$|(?:^|\.)yelp\.ca$/i,
    profile(u) {
      const segs = pathSegs(u);
      if (segs[0] !== "biz" || !segs[1]) return null;
      return { handle: segs[1], canonical: `https://www.yelp.com/biz/${segs[1]}` };
    },
  },
  {
    key: "bbb",
    label: "BBB",
    host: /(?:^|\.)bbb\.org$/i,
    profile(u) {
      // /us/in/indianapolis/profile/plumber/carters-my-plumber-0382-90036102
      // The segment after "profile" is the TRADE, not the business — reading it
      // as the handle gave "plumber", which would match every plumber alive.
      // The business slug is the last segment...
      const segs = pathSegs(u);
      const i = segs.indexOf("profile");
      if (i < 0) return null;
      // ...but ONLY once the tab segments are gone. Rescue Rooter's live chip
      // ended in /customer-reviews, so "customer-reviews" WAS the handle, and
      // the title carried the name and waved it through. Mainstream Electric's
      // chip ended in /complaints — a "BBB" button that opens the client's own
      // complaints tab in front of the prospect. Both now canonicalise to the
      // profile root, which is the page the business would want linked.
      const trimmed = segs.slice(0, segs.length - trailingTabs(segs, BBB_TABS));
      if (trimmed.length < i + 3) return null;
      const last = trimmed[trimmed.length - 1];
      if (!last || isPlatformHandle(last)) return null;
      return { handle: last.replace(/-\d{3,}(-\d+)?$/, ""), canonical: `https://www.bbb.org/${trimmed.join("/")}` };
    },
  },
  {
    key: "angi",
    label: "Angi",
    host: /(?:^|\.)angi\.com$|(?:^|\.)angieslist\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      // A REAL Angi listing carries the listing's numeric id:
      //   /companylist/us/mo/kansas-city/poor-john's-plumbing-reviews-271264.htm
      // A CATEGORY page does not:
      //   /companylist/us/wi/green-bay/plumbing.htm
      // That is the whole difference between the client's profile and a ranked
      // list of the people trying to take his work, and it is the defect that
      // shipped live on Plumbers Green Bay. No id, no chip.
      const last = (segs[segs.length - 1] || "").replace(/\.html?$/, "");
      if (segs[0] !== "companylist" && segs[0] !== "profile") return null;
      if (!last || isPlatformHandle(last)) return null;
      // ANY listing id counts, including a one-digit one. Professional Piping's
      // real Angi page is ".../professional-piping-inc-reviews-1.htm" and an
      // id-length rule refused it — a gate that deletes a genuine profile to
      // catch a category page is not a stricter gate, it is a broken one.
      if (!/-\d+$/.test(last)) return null;
      return { handle: last.replace(/-reviews?-\d+$/, "").replace(/-\d+$/, ""), canonical: `https://www.angi.com${u.pathname}` };
    },
  },
  {
    key: "nextdoor",
    label: "Nextdoor",
    host: /(?:^|\.)nextdoor\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      if (segs[0] !== "pages" || !segs[1]) return null;
      return { handle: segs[1], canonical: `https://nextdoor.com/pages/${segs[1]}/` };
    },
  },
  {
    key: "houzz",
    label: "Houzz",
    host: /(?:^|\.)houzz\.com$/i,
    profile(u) {
      const segs = pathSegs(u);
      if (segs[0] !== "professionals" && segs[0] !== "pro") return null;
      const last = segs[segs.length - 1] || "";
      if (!last || isPlatformHandle(last)) return null;
      return { handle: last.replace(/-pfvwus-pf~\d+$/i, ""), canonical: `https://www.houzz.com${u.pathname}` };
    },
  },
]);

function pathSegs(u) {
  return String(u.pathname || "").split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
}

/**
 * Sub-pages of a BBB profile. These are TABS, not identities: the profile is
 * the same business either way, but "/complaints" is the last page on earth we
 * would put a button to in a pitch, and "/customer-reviews" as a path tail once
 * made "customer-reviews" the matched handle.
 */
const BBB_TABS = new Set(["customer-reviews", "complaints", "details", "accreditation", "reviews"]);

function trailingTabs(segs, tabs) {
  let n = 0;
  while (n < segs.length && tabs.has(String(segs[segs.length - 1 - n]).toLowerCase())) n++;
  return n;
}

/**
 * Classify a URL as an owned-able profile on a known network, or null.
 * Null is the answer for every share widget, every listing index and every
 * post permalink — none of those are an identity we can hand to a visitor.
 */
function classifyProfileUrl(raw, base = "https://x.invalid") {
  let u;
  try { u = new URL(String(raw || "").trim(), base); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  for (const net of NETWORKS) {
    if (!net.host.test(u.hostname)) continue;
    let hit = null;
    try { hit = net.profile(u); } catch { hit = null; }
    if (!hit || !hit.handle) return null;
    return {
      network: net.key, label: net.label, handle: String(hit.handle), url: hit.canonical,
      ...(hit.personalSurface ? { personalSurface: true } : {}),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Name matching — the gate on anything not linked from their own site.
// ---------------------------------------------------------------------------

/**
 * Tokens that identify a legal wrapper or a whole trade rather than THIS
 * business. Half the plumbers in a metro share "plumbing" and "services"; a
 * match on those alone is not evidence of anything.
 */
const GENERIC_TOKENS = new Set([
  "the", "and", "of", "a", "an", "at", "for", "your", "we",
  "llc", "l", "l.l.c", "inc", "incorporated", "co", "corp", "corporation", "ltd", "company", "companies", "group", "holdings", "enterprises",
  "plumbing", "plumber", "plumbers", "roofing", "roofer", "roofers", "hvac", "heating", "cooling", "air", "electric", "electrical", "electrician",
  "landscaping", "landscape", "lawn", "concrete", "construction", "contracting", "contractors", "contractor",
  "services", "service", "solutions", "systems", "repair", "repairs", "installation", "maintenance", "supply",
  "salon", "spa", "medspa", "tattoo", "studio", "shop", "barbers", "barber", "nails", "nail", "hair", "beauty",
  "home", "homes", "pro", "pros", "expert", "experts", "team", "family", "local", "best", "quality", "affordable",
  "usa", "us", "america", "american", "national", "official",
]);

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The business's NAME, separated from the keyword stuffing after it.
 *
 * Google Business Profile names are routinely written for search, not for
 * humans: "Carter's My Plumber - Plumbers Indianapolis, Water Heater Repair".
 * Requiring a Facebook handle to contain "indianapolis", "water", "heater" and
 * "repair" refuses the business's OWN page — measured on the live Carter's
 * mirror, which attached 1 profile and refused 7, five of which were verifiably
 * theirs. That is not strictness, it is a bug wearing strictness as a costume:
 * we lost real assets and gained no protection.
 *
 * So the name is taken up to the first separator, and ONLY when that leading
 * segment still carries two distinctive tokens of its own — which keeps the
 * "one token is not an identity" rule intact. Everything after the separator
 * is SEO, and no social handle was ever going to contain it.
 */
function coreName(businessName) {
  const raw = String(businessName || "");
  const head = raw.split(/\s[-–—|]\s|[|,]/)[0].trim();
  return head && distinctiveTokensRaw(head).length >= 2 ? head : raw;
}

function distinctiveTokensRaw(businessName) {
  const all = tokenize(businessName);
  const kept = all.filter((t) => !GENERIC_TOKENS.has(t) && t.length > 1);
  return kept.length ? kept : all.filter((t) => t.length > 1);
}

/** The tokens that actually distinguish THIS business from its competitors. */
function distinctiveTokens(businessName) {
  const all = tokenize(coreName(businessName));
  const kept = all.filter((t) => !GENERIC_TOKENS.has(t) && t.length > 1);
  // A business genuinely named only from generic words ("Local Plumbing Co")
  // has no distinctive handle to match on. Fall back to the full token list so
  // we do not accidentally match EVERYTHING — a longer required set is a
  // stricter test, never a looser one.
  return kept.length ? kept : all.filter((t) => t.length > 1);
}

function squash(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Does this candidate profile unambiguously name the business?
 *
 * EVERY distinctive token must appear in the handle or the search title. All,
 * not most: "Miller Plumbing" must not adopt "Miller Roofing"'s Facebook page,
 * and a partial match is exactly how that happens.
 */
function nameMatchesBusiness(businessName, { handle = "", title = "", description = "" } = {}) {
  const need = distinctiveTokens(businessName);
  if (!need.length) return false;
  // ONE DISTINCTIVE TOKEN IS NOT AN IDENTITY.
  //
  // "Miller Plumbing Inc" reduces to ["miller"], and "millerroofing" contains
  // "miller" — so a single-token business would happily adopt Miller Roofing's
  // Facebook page, which is the manufacturer-badge failure exactly. There is no
  // clever fix: the name genuinely does not distinguish them. So a search hit
  // is REFUSED for these businesses and only an own_site_link can attach a
  // profile. They lose an optional chip; they never get a stranger's.
  if (need.length < 2) return false;
  const handleHay = squash(handle);
  const titleHay = squash(title);
  // The DESCRIPTION is deliberately not part of the haystack. A directory blurb
  // that merely mentions the business ("...competitors include Carter's My
  // Plumber...") is not a claim that the page IS the business.
  const inHandle = need.every((t) => handleHay.includes(squash(t)));
  const inTitle = need.every((t) => titleHay.includes(squash(t)));
  void description;
  return inHandle || inTitle;
}

// ---------------------------------------------------------------------------
// LOCALITY — the half of "is this them?" that a name can never answer.
//
// "Rescue Rooter" IS the name of the Portland business. It is also the name of
// the Austin one, the Aurora one and the Memphis one, because it is a national
// franchise. Every name test in the world passes ars-rescue-rooter-austin-5 for
// a Portland plumber. Only geography separates them.
//
// This test is CONTRADICTION-ONLY. It needs positive proof of a different state
// to refuse. It must never require proof of the right state, because Carter's
// Yelp listing is filed under Greenwood while the record says Indianapolis, and
// a test that demanded a city match would delete a perfectly good chip. States
// do not have that problem: Greenwood and Indianapolis are both IN.
// ---------------------------------------------------------------------------

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT " +
  "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "));

const STATE_NAMES = Object.freeze({
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
});

/** "Oregon" and "or" and "OR" are one state; anything else is not a state. */
function normalizeState(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const up = raw.toUpperCase();
  if (up.length === 2 && US_STATES.has(up)) return up;
  return STATE_NAMES[raw.toLowerCase()] || "";
}

const STATE_IN_TEXT = new RegExp(String.raw`,\s*(${[...US_STATES].join("|")})\b(?=\s*\d{5}|[\s,.;:)"'’]|$)`, "g");

/**
 * Which states touch which. This is the difference between a metro that
 * straddles a border and a franchise on the other side of the country.
 *
 * D&F Plumbing trades in Portland OR and its BBB listing is filed in Vancouver
 * WA — ten minutes away, across the river, the same market. Refusing that chip
 * on a bare state mismatch would delete a real asset from a real pitch. Rescue
 * Rooter's Memphis TN and Austin TX listings are not a border case, they are a
 * different company serving different people 2,000 miles away.
 *
 * So a cross-state profile survives only when the states are NEIGHBOURS.
 */
const ADJACENT = Object.freeze({
  AL: "FL GA MS TN", AK: "", AZ: "CA CO NM NV UT", AR: "LA MS MO OK TN TX",
  CA: "AZ NV OR", CO: "AZ KS NE NM OK UT WY", CT: "MA NY RI", DE: "MD NJ PA",
  DC: "MD VA", FL: "AL GA", GA: "AL FL NC SC TN", HI: "", ID: "MT NV OR UT WA WY",
  IL: "IN IA KY MO WI", IN: "IL KY MI OH", IA: "IL MN MO NE SD WI",
  KS: "CO MO NE OK", KY: "IL IN MO OH TN VA WV", LA: "AR MS TX",
  ME: "NH", MD: "DC DE PA VA WV", MA: "CT NH NY RI VT", MI: "IN OH WI",
  MN: "IA ND SD WI", MS: "AL AR LA TN", MO: "AR IL IA KS KY NE OK TN",
  MT: "ID ND SD WY", NE: "CO IA KS MO SD WY", NV: "AZ CA ID OR UT",
  NH: "MA ME VT", NJ: "DE NY PA", NM: "AZ CO OK TX UT", NY: "CT MA NJ PA VT",
  NC: "GA SC TN VA", ND: "MN MT SD", OH: "IN KY MI PA WV", OK: "AR CO KS MO NM TX",
  OR: "CA ID NV WA", PA: "DE MD NJ NY OH WV", RI: "CT MA", SC: "GA NC",
  SD: "IA MN MT NE ND WY", TN: "AL AR GA KY MS MO NC VA", TX: "AR LA NM OK",
  UT: "AZ CO ID NM NV WY", VT: "MA NH NY", VA: "DC KY MD NC TN WV",
  WA: "ID OR", WV: "KY MD OH PA VA", WI: "IA IL MI MN", WY: "CO ID MT NE SD UT",
});

/** True when the profile's state is neither the home state nor next door to it. */
function statesConflict(homeState, otherState) {
  const a = normalizeState(homeState), b = normalizeState(otherState);
  if (!a || !b || a === b) return false;
  return !String(ADJACENT[a] || "").split(" ").includes(b);
}

/** Every US state a blob of prose commits to ("...Austin, TX 78754..." -> TX). */
function statesInText(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(STATE_IN_TEXT)) out.add(m[1]);
  return out;
}

/** The state a directory encodes in its own path: /us/tn/memphis/profile/... */
function stateFromProfilePath(url) {
  const m = /\/us\/([a-z]{2})\//i.exec(String(url || ""));
  return m && US_STATES.has(m[1].toUpperCase()) ? m[1].toUpperCase() : "";
}

/**
 * Where this business actually is.
 *
 * The record's own city/state is the truth when the caller passes it. When it
 * does not, the business's own homepage is the next best witness and it is
 * already in our hands — six of the seven audited prospects publish
 * schema.org addressRegion on the page we fetched for free. The seventh
 * publishes nothing, and that is fine: an unknown home state means no locality
 * verdict at all, never a refusal.
 */
function homeLocality({ city = "", state = "", html = "" } = {}) {
  const known = normalizeState(state);
  if (known) return { city: String(city || "").trim(), state: known };
  const text = String(html || "");
  for (const m of text.matchAll(/"addressRegion"\s*:\s*"([^"]{2,30})"/g)) {
    const st = normalizeState(m[1]);
    if (st) {
      const loc = /"addressLocality"\s*:\s*"([^"]{2,40})"/.exec(text);
      return { city: String(city || (loc && loc[1]) || "").trim(), state: st };
    }
  }
  const found = statesInText(text.replace(/<[^>]+>/g, " "));
  return { city: String(city || "").trim(), state: found.size === 1 ? [...found][0] : "" };
}

// ---------------------------------------------------------------------------
// FOLLOWING THE LINK — reading what the destination says it is.
// ---------------------------------------------------------------------------

/**
 * Titles that are the platform talking, not the profile. A bot wall, a login
 * shell and a CDN challenge all return 200 with a title; none of them is an
 * attestation of anything, and treating one as a name match would be exactly
 * the "QC PASS is never proof" failure in a new place.
 */
const NON_ATTESTING_TITLE = [
  /^instagram$/i, /^tiktok\b/i, /^facebook$/i, /^linkedin$/i, /^error$/i, /^[a-z0-9.-]+\.(com|org)$/i,
  /just a moment/i, /attention required/i, /client challenge/i, /access denied/i, /are you a robot/i,
  /page not found/i, /^log in/i, /^sign up/i, /security check/i, /captcha/i, /^redirecting/i,
];

/** Trailing platform branding on a profile title: "Carter's My Plumber - YouTube". */
const TITLE_SUFFIX = /\s*[-|–—]\s*(youtube|linkedin|nextdoor|facebook|instagram|tiktok|yelp|angi|houzz|better business bureau|bbb)\s*$/i;

/**
 * A destination whose headline is a RANKING is a directory index, no matter how
 * many of the client's name tokens it happens to contain. "Top 10 Best Plumbers
 * in Green Bay, WI" is the page we linked a Green Bay plumber to.
 */
const INDEX_TITLE = [
  /^\s*top\s+\d+\b/i, /^\s*\d+\s+best\b/i, /\bbest\b[^|]{0,40}\bin\b/i, /\bbest\b[^|]{0,30}\bnear\b/i,
  /\bnear\s+(you|me)\b/i, /\bdirectory of\b/i, /\b(companies|contractors|businesses|pros|plumbers|roofers|electricians)\s+(in|near)\b/i,
  /\bcompare\b[^|]{0,30}\bquotes\b/i, /\bsearch results\b/i, /\bcategory\b/i,
];

/** A destination that says, in its own words, that it belongs to a PERSON. */
const PERSON_PAGE = [
  /view\s+[^.]{2,60}'?s?\s+profile\s+on\s+linkedin/i,
  /\b\d+\+?\s+connections?\b/i,
  /^[^|]{2,40}\s+[-–—]\s+[^|]{0,40}\bat\b\s+[^|]{2,60}$/i, // "Terri Welker - Owner at Poor John's Plumbing, LLC"
];

/**
 * What a fetched page attests about itself: its name, the states it commits to,
 * and whether it is admitting to being an index or a person.
 */
function readAttestation(html = "") {
  const text = String(html || "");
  const pick = (rx) => { const m = rx.exec(text); return m ? decodeEntities(m[1]).trim() : ""; };
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i)
    || pick(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:title["']/i);
  const docTitle = pick(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i).replace(/\s+/g, " ");
  const ogDesc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["']/i);
  const ldName = pick(/"@type"\s*:\s*"[^"]*(?:LocalBusiness|Organization|Plumber|HVACBusiness|Contractor)[^"]*"[\s\S]{0,400}?"name"\s*:\s*"([^"]{1,120})"/i);
  const nickname = pick(/"nickname"\s*:\s*"([^"]{1,120})"/);

  const rawTitle = ogTitle || docTitle;
  const attesting = rawTitle && !NON_ATTESTING_TITLE.some((rx) => rx.test(rawTitle.trim()));
  const name = attesting ? rawTitle.replace(TITLE_SUFFIX, "").trim() : (ldName || nickname || "");

  const hay = `${rawTitle} ${ogDesc}`;
  return {
    name: String(name || "").slice(0, 160),
    title: String(rawTitle || "").slice(0, 200),
    states: statesInText(hay),
    isIndex: INDEX_TITLE.some((rx) => rx.test(rawTitle)),
    isPerson: PERSON_PAGE.some((rx) => rx.test(rawTitle) || rx.test(ogDesc)),
    // A SOFT 404. YouTube serves "This channel does not exist" with HTTP 200
    // and no og:title at all — which reads to every status check as "readable,
    // just uninformative". Universal Plumbing's chip pointed at
    // /channel/UCkfGnmWogywVKerTEvDBB8Q and shipped on that basis. The phrase
    // is quoted from the page itself, so it is evidence, not inference.
    // Scan the WHOLE body the follower kept. YouTube buries this alert at byte
    // 740,587 of a 755KB document; a 400KB scan window read the page and threw
    // the answer away, which is the same mistake the 600KB fetch cap made.
    isGone: GONE_MARKERS.some((rx) => rx.test(text)),
  };
}

// A SOFT-404 MARKER MUST BE STRUCTURAL, NOT A PHRASE.
//
// My first version of this list matched the bare phrase "Couldn't find this
// account", and it refused https://www.tiktok.com/@universalplumbing — a LIVE
// profile with 34 followers that I had already opened in Chromium. TikTok ships
// its entire i18n dictionary inline, so that phrase is present at byte 198,176
// of the healthy page and the dead one alike. A phrase that both pages contain
// carries no information, and a rule built on one deletes real profiles — the
// exact failure this file was written to stop.
//
// So each entry below is tied to the ERROR STRUCTURE the platform emits, and is
// verified against a live control in the tests. Platforms with no such
// structure (TikTok, Instagram) get no soft-404 rule at all; a real 404 status
// still catches them.
const GONE_MARKERS = [
  // YouTube renders the message inside an ERROR alertRenderer. A channel that
  // exists has no alertRenderer of type ERROR anywhere in its payload.
  /"alertRenderer"\s*:\s*\{\s*"type"\s*:\s*"ERROR"[\s\S]{0,200}?(?:channel|account) does not exist/i,
];

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Does the URL's own PATH name this business beyond argument?
 *
 * This is the ONLY thing that can carry a chip whose destination we could not
 * read, so it is deliberately harder than nameMatchesBusiness: the SEARCH TITLE
 * is not admissible here. A title is written by the directory; a path is
 * written when the profile is created.
 */
function handleEncodesBusiness(businessName, handle) {
  const need = distinctiveTokens(businessName);
  const hay = squash(handle);
  if (!need.length || !hay) return false;
  if (need.every((t) => hay.includes(squash(t)))) return true;
  // A faithful truncation is still unambiguous: "americasplumbingco" is the
  // front of "America's Plumbing Company" and could be nobody else.
  const full = squash(coreName(businessName));
  return hay.length >= 12 && full.startsWith(hay);
}

/**
 * THE OWNERSHIP VERDICT for one candidate chip.
 *
 * Returns { ok, reason, evidence }. `reason` is a stable machine key and
 * `evidence` is the sentence an operator can check by hand — because the last
 * pass reported a count of chips rather than what any of them pointed at, and
 * a count cannot be audited.
 *
 * @param {object} o
 * @param {object} o.candidate   a classifyProfileUrl hit + provenance
 * @param {string} o.businessName
 * @param {object} o.home        { city, state } — "" state means "unknown", never "wrong"
 * @param {Set}    o.rowStates   states the search results attested for THIS canonical url
 * @param {object} o.fetched     { ok, status, html } from following the link, or null
 */
function judgeProfile({ candidate, businessName = "", home = {}, rowStates = new Set(), fetched = null } = {}) {
  const selfLinked = candidate.provenance === "own_site_link";
  const homeState = normalizeState(home.state);
  const seen = fetched && fetched.ok && fetched.html ? readAttestation(fetched.html) : null;
  const readable = !!(seen && (seen.name || seen.isIndex || seen.isPerson));

  // --- 1. A LinkedIn member page is a private individual's page. ------------
  // Structural, not a guess: /company/ is the business, /in/ is a person. It is
  // refused unless the slug itself is the business's name, and it is refused
  // even when the business linked it from its own footer, because the owner's
  // private page is still the owner's private page. Poor John's shipped
  // /in/terri-welker-64822a20; Platero Parada shipped /in/samuel-platero-...
  if (candidate.personalSurface && !handleEncodesBusiness(businessName, candidate.handle)) {
    if (!readable || seen.isPerson || !nameMatchesBusiness(businessName, { handle: seen.name, title: seen.name })) {
      return { ok: false, reason: "personal_profile", evidence: `${candidate.url} is a LinkedIn member page for a named individual, not a company page for ${businessName}` };
    }
  }

  // --- 2. Locality contradiction. ------------------------------------------
  // Only ever fires on positive proof of a different state.
  if (homeState) {
    const pathState = stateFromProfilePath(candidate.url);
    if (statesConflict(homeState, pathState)) {
      return { ok: false, reason: "locality_contradiction", evidence: `${candidate.url} is filed under ${pathState}; ${businessName} trades in ${homeState}, which does not border it` };
    }
    const attested = seen ? [...seen.states] : [];
    if (attested.length && attested.every((st) => statesConflict(homeState, st))) {
      return { ok: false, reason: "locality_contradiction", evidence: `the page at ${candidate.url} says it is in ${attested.join("/")}; ${businessName} trades in ${homeState}` };
    }
    const pooled = [...rowStates];
    if (!selfLinked && pooled.length && pooled.every((st) => statesConflict(homeState, st))) {
      return { ok: false, reason: "locality_contradiction", evidence: `every search result for ${candidate.url} places it in ${pooled.join("/")}; ${businessName} trades in ${homeState}` };
    }
  }

  // --- 3. What the destination admits to being. ----------------------------
  if (readable) {
    if (seen.isIndex) {
      return { ok: false, reason: "directory_index_page", evidence: `${candidate.url} titles itself "${seen.title}" — a ranked list, not ${businessName}'s profile` };
    }
    if (seen.isPerson && !handleEncodesBusiness(businessName, candidate.handle)) {
      return { ok: false, reason: "personal_profile", evidence: `${candidate.url} titles itself "${seen.title}" — a person's page` };
    }
    if (seen.name && nameMatchesBusiness(businessName, { handle: seen.name, title: seen.name })) {
      return { ok: true, reason: "destination_attested", evidence: `followed ${candidate.url}; the page calls itself "${seen.name}"` };
    }
    if (seen.name && !selfLinked && !handleEncodesBusiness(businessName, candidate.handle)) {
      return { ok: false, reason: "destination_is_not_this_business", evidence: `followed ${candidate.url}; the page calls itself "${seen.name}", which is not ${businessName}` };
    }
  }

  // --- 3b. The destination is GONE. ----------------------------------------
  // 404/410 is not "the door was shut", it is proof of absence, and it
  // outranks every other kind of ownership evidence including the business's
  // own footer. Two live examples, both found by following the link:
  // youtube.com/channel/UCkfGnmWogywVKerTEvDBB8Q on Universal Plumbing renders
  // "This channel does not exist", and youtube.com/@fivestarhomeservices — a
  // link on Five Star's OWN site — answers 404. A stale link in a footer is
  // exactly the kind of thing a business stops maintaining; shipping it sends
  // the prospect's customer to an error page under the prospect's own brand.
  if (fetched && (fetched.status === 404 || fetched.status === 410)) {
    return { ok: false, reason: "destination_gone", evidence: `${candidate.url} answers HTTP ${fetched.status}; the profile no longer exists` };
  }
  if (seen && seen.isGone) {
    return { ok: false, reason: "destination_gone", evidence: `${candidate.url} answers 200 but the page says the profile does not exist` };
  }

  // --- 4. The door was shut. -----------------------------------------------
  // Yelp/BBB/Angi answer 403, LinkedIn members 999, Facebook 400. A URL we
  // could not read ships only on self-assertion or on a path that names the
  // business by itself.
  if (selfLinked) {
    return { ok: true, reason: "own_site_link", evidence: `${businessName} links ${candidate.url} from its own site` };
  }
  if (handleEncodesBusiness(businessName, candidate.handle)) {
    return { ok: true, reason: "path_encodes_business", evidence: `${candidate.url} could not be read (${describeFetch(fetched)}); its path carries every distinctive token of ${businessName}` };
  }
  return { ok: false, reason: "unverifiable_url", evidence: `${candidate.url} could not be read (${describeFetch(fetched)}) and its path does not name ${businessName}` };
}

function describeFetch(fetched) {
  if (!fetched) return "not fetched";
  if (fetched.status) return `HTTP ${fetched.status}`;
  return fetched.reason || "unreachable";
}

/** The default link-follower. Browser-shaped, short-fused, and never throws. */
const FOLLOW_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function followLink(url, { fetchImpl = global.fetch, timeoutMs = 12000 } = {}) {
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers: { "user-agent": FOLLOW_UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // MEASURE BEFORE YOU CAP. YouTube ships ~1.1MB of inline app state before
    // it gets round to <title>: on Carter's channel the og:title sits at byte
    // 739,442. A 600KB cap silently threw away the only proof that opaque
    // channel id UCDoJnM4wYkqxUWK3KoYPfkw was theirs, and the chip was refused
    // for being "unreadable" when we had in fact read it and binned the answer.
    // A truncation that can manufacture a wrong verdict is not a safeguard.
    const html = res.ok ? await res.text() : "";
    return { ok: res.ok, status: res.status, html: html.slice(0, 2000000) };
  } catch (e) {
    return { ok: false, status: 0, html: "", reason: String((e && e.message) || e).slice(0, 120) };
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Every profile URL linked from the client's own HTML. Ownership is implied. */
function profilesFromOwnSite(html, siteUrl = "") {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const hit = classifyProfileUrl(m[1], siteUrl || "https://x.invalid");
    if (!hit) continue;
    const dedupe = `${hit.network}:${squash(hit.handle)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ ...hit, provenance: "own_site_link", evidence: siteUrl || "" });
  }
  return out;
}

/** One profile per network, own-site links always beating search results. */
function mergeByNetwork(lists) {
  const best = new Map();
  const rank = { own_site_link: 2, named_match: 1 };
  for (const item of [].concat(...lists)) {
    const cur = best.get(item.network);
    if (!cur || (rank[item.provenance] || 0) > (rank[cur.provenance] || 0)) best.set(item.network, item);
  }
  // Stable, deliberate order: the networks a homeowner recognises first.
  const order = NETWORKS.map((n) => n.key);
  return [...best.values()].sort((a, b) => order.indexOf(a.network) - order.indexOf(b.network));
}

/**
 * Find the profiles this business owns.
 *
 * @param {object}   o
 * @param {string}   o.businessName   used for the strict named_match test
 * @param {string}   o.siteUrl        their own site (the base for relative hrefs)
 * @param {string}   o.html           their homepage HTML, if already fetched
 * @param {string}   o.city           the record's own city, when the caller has it
 * @param {string}   o.state          the record's own state — the locality test's
 *                                    best witness; falls back to reading `html`
 * @param {function} o.search         async ({query, limit}) => {ok, results:[{url,title,description}]}
 * @param {number}   o.maxSearches    hard cap on billed search calls
 * @param {function} o.follow         async (url) => {ok, status, html} — the link
 *                                    follower. Injected so ownership is testable
 *                                    offline; pass null to skip following, which
 *                                    makes every unreadable URL fall back to the
 *                                    path test rather than silently passing.
 * @param {function} o.fetchImpl      the fetch the DEFAULT follower uses. A caller
 *                                    that already injects a fake fetch (the miner
 *                                    does) must pass it here too, or its offline
 *                                    tests would quietly start calling Yelp.
 * @param {number}   o.maxFollows     hard cap on link-following fetches
 * @returns {Promise<{profiles, searchCalls, followCalls, refused, home}>}
 */
async function discoverSocials({
  businessName = "", siteUrl = "", html = "", city = "", state = "",
  search = null, maxSearches = 1, follow = undefined, fetchImpl = undefined, maxFollows = 12,
} = {}) {
  if (follow === undefined) follow = (url) => followLink(url, fetchImpl ? { fetchImpl } : {});
  const refused = [];
  const fromSite = profilesFromOwnSite(html, siteUrl);
  const home = homeLocality({ city, state, html });

  let searchCalls = 0;
  const fromSearch = [];
  // States each canonical profile URL was attested to be in, pooled across
  // EVERY search row that points at it. Yelp served us
  // /biz/ars-rescue-rooter-austin-5 twice: once with a bare title, and once
  // with "8619 Wall St, Ste 600, Austin, TX 78754" in the snippet. Pooling is
  // what turns the second row into a refusal of the first.
  const rowStatesByUrl = new Map();
  const haveNetworks = new Set(fromSite.map((p) => p.network));
  const wantMore = NETWORKS.some((n) => !haveNetworks.has(n.key));

  if (search && wantMore && maxSearches > 0 && String(businessName).trim()) {
    let host = "";
    try { host = new URL(siteUrl).hostname.replace(/^www\./, ""); } catch { /* a bare name still searches */ }
    // ONE query does the whole job: the business name plus its domain, which
    // is the string their real profiles actually carry. Per-network queries
    // would multiply the bill for the same rows.
    const query = [businessName, host, "facebook instagram yelp bbb linkedin youtube"].filter(Boolean).join(" ");
    let res = null;
    try { res = await search({ query, limit: 20 }); } catch (e) { res = { ok: false, reason: String(e && e.message || e).slice(0, 160) }; }
    searchCalls++;
    const rows = (res && res.ok && Array.isArray(res.results)) ? res.results : [];

    for (const row of rows) {
      const hit = classifyProfileUrl(row.url);
      if (!hit) continue;
      const pooled = rowStatesByUrl.get(hit.url) || new Set();
      for (const st of statesInText(`${row.title || ""} | ${row.description || ""}`)) pooled.add(st);
      rowStatesByUrl.set(hit.url, pooled);
    }

    const seenUrls = new Set();
    for (const row of rows) {
      const hit = classifyProfileUrl(row.url);
      if (!hit) continue;
      if (haveNetworks.has(hit.network)) continue;
      if (seenUrls.has(hit.url)) continue;
      seenUrls.add(hit.url);
      if (!nameMatchesBusiness(businessName, { handle: hit.handle, title: row.title, description: row.description })) {
        // Named refusals, so the operator can see WHAT we declined to attach
        // and why. A silent drop here is how a wrong page sneaks back in.
        refused.push({ url: hit.url, network: hit.network, reason: "name_not_unambiguous", handle: hit.handle, title: String(row.title || "").slice(0, 120) });
        continue;
      }
      fromSearch.push({ ...hit, provenance: "named_match", evidence: String(row.url || ""), title: String(row.title || "").slice(0, 160) });
    }
  }

  // -------------------------------------------------------------------------
  // NOW FOLLOW THE LINKS. Everything above is a claim about a URL; this is the
  // only part that looks at the page. It runs over own-site links as well as
  // search hits, because Platero Parada's own footer is where the private
  // LinkedIn came from — self-assertion proves the business chose the link, not
  // that the link points at a business.
  // -------------------------------------------------------------------------
  const candidates = mergeByNetwork([fromSite, fromSearch]);
  const kept = [];
  let followCalls = 0;

  // IN PARALLEL. There are at most ten of these and they are independent, on
  // ten different hosts. Done one at a time behind a 12s timeout they could add
  // two minutes to a build that is supposed to take under thirty seconds, and a
  // correctness fix that makes the line unusable gets switched off.
  const fetches = await Promise.all(candidates.map(async (candidate, i) => {
    if (!follow || i >= maxFollows) return null;
    followCalls++;
    try { return await follow(candidate.url); } catch (e) { return { ok: false, status: 0, html: "", reason: String((e && e.message) || e).slice(0, 120) }; }
  }));

  for (const [i, candidate] of candidates.entries()) {
    const fetched = fetches[i];
    let verdict;
    try {
      verdict = judgeProfile({ candidate, businessName, home, rowStates: rowStatesByUrl.get(candidate.url) || new Set(), fetched });
    } catch (e) {
      // A thrown judge must not become an attached chip. Refuse and say so.
      verdict = { ok: false, reason: "verification_threw", evidence: String((e && e.message) || e).slice(0, 160) };
    }
    if (!verdict.ok) {
      refused.push({ url: candidate.url, network: candidate.network, handle: candidate.handle, reason: verdict.reason, evidence: verdict.evidence, ...(candidate.title ? { title: candidate.title } : {}) });
      continue;
    }
    const { title, personalSurface, ...rest } = candidate;
    void title; void personalSurface;
    kept.push({ ...rest, verifiedBy: verdict.reason, verifiedEvidence: verdict.evidence });
  }

  return { profiles: kept, searchCalls, followCalls, refused, home };
}

module.exports = {
  NETWORKS,
  coreName,
  classifyProfileUrl,
  distinctiveTokens,
  nameMatchesBusiness,
  profilesFromOwnSite,
  mergeByNetwork,
  discoverSocials,
  // The ownership pass, exported so it can be tested — and audited — on its own.
  normalizeState,
  statesConflict,
  statesInText,
  stateFromProfilePath,
  homeLocality,
  readAttestation,
  handleEncodesBusiness,
  judgeProfile,
  followLink,
};
