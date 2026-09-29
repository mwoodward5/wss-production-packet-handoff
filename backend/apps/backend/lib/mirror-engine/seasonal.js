"use strict";
// lib/mirror-engine/seasonal.js — vertical-aware seasonal merchandising.
//
// WHAT THIS IS
// A config-driven seasonal section the mirror engine renders onto the home
// page at build time: 2-4 "moment" cards per vertical (hvac, plumbing,
// roofing, landscaping, fencing, electrical), of which the ones whose month
// window contains the BUILD DATE are rendered — HVAC gets a pre-summer
// tune-up card in May and a furnace-check card in October, never both at
// once, and a roofer never reads an HVAC line.
//
// THE THREE LAWS
//
// 1. THE FLAG IS OFF BY DEFAULT. Nothing renders unless the caller passes
//    facts.features.seasonal === true. A build that does not ask for
//    merchandising must never discover it has some.
//
// 2. ONLY CERTIFIED SERVICES ARE NAMED. Every card is bound to a service
//    regex; the card renders only when the business's OWN verified service
//    list contains a matching service, and the copy is written AROUND the
//    matched service name — a business that lists no tune-up service never
//    sees a tune-up card, with or without the flag. assertSeasonalCopyCertified
//    re-proves this over the rendered bytes, and refuses the merchanising
//    classics: prices, "% off", "free", "limited time", guarantees, urgency.
//    There is no offer language in the catalog to find.
//
// 3. THE PALETTE IS THE SITE'S. The section styles itself from the site's own
//    CSS custom properties (--accent / --accent-ink, the same tokens the
//    authority pages read), so it inherits whatever brand the engine applied
//    and never ships a colour the client did not choose.
//
// The catalog is DATA, deliberately boring: vertical → season → months → copy
// template. A new vertical or a new moment is an entry here, not code.

// Month numbers are 1-12 (getMonth() + 1), so a config line reads as calendar
// months, not as an off-by-one.
const FLAG_PATH = "facts.features.seasonal";

/** The vertical an industry string belongs to, or null when it matches none. */
function verticalFor(industry) {
  const s = String(industry || "").toLowerCase();
  if (!s) return null;
  // Order matters: the longer, more specific trades are tested before the
  // generic ones, so "fence" never falls through to "general contractor".
  if (/hvac|air[- ]?cond|heating|furnace|ac\b|cooling|heating and air/.test(s)) return "hvac";
  if (/plumb/.test(s)) return "plumbing";
  if (/roof/.test(s)) return "roofing";
  if (/landscap|lawn|yard|tree service|garden|irrigation/.test(s)) return "landscaping";
  if (/fence/.test(s)) return "fencing";
  if (/electric/.test(s)) return "electrical";
  return null;
}

/** The first service name in the business's OWN list the regex matches. */
function certifiedService(services, re) {
  for (const raw of services || []) {
    const name = String(raw && typeof raw === "object" ? raw.name : raw || "").trim();
    if (name && re.test(name)) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE CATALOG. months are 1-12; match binds the card to a certified service;
// copy templates receive { facts, service, city } and may name ONLY the
// certified service and facts the engine already verified. No prices, no
// offers, no urgency, no superlatives — a seasonal moment, not an ad.
// ---------------------------------------------------------------------------
const SEASONAL_CATALOG = {
  hvac: [
    {
      id: "pre-summer-tune-up",
      season: "late-spring",
      months: [4, 5, 6],
      match: /tune|maint|inspect|check|clean/i,
      heading: "Cooling season is close",
      body: ({ facts, service, city }) =>
        `An air conditioner that ran hard through the last summer has had three seasons of dust settle on it since anyone looked. ${facts.business_name} lists ${service} among its work in ${city} — the sensible moment for it is before the first hot week, not during one.`,
    },
    {
      id: "fall-furnace-check",
      season: "fall",
      months: [9, 10, 11],
      match: /furnace|heating|heat|inspect|maint|tune|check/i,
      heading: "Heating season, checked early",
      body: ({ facts, service, city }) =>
        `The first cold night is a poor time to learn that a furnace spent the summer collecting dust. ${facts.business_name} lists ${service} among its work in ${city}; a fall look at the heating side of the system is the ordinary, unglamorous way to avoid the dramatic one.`,
    },
    {
      id: "shoulder-season-swap",
      season: "shoulder",
      months: [3, 12],
      match: /thermostat|filter|maintenance|inspect|check/i,
      heading: "The between-seasons hour",
      body: ({ facts, service, city }) =>
        `Spring and the year's last weeks are when an HVAC system switches jobs. ${facts.business_name} lists ${service} among its work in ${city} — the switch-over visit that is routine in March is the emergency call nobody wants in August.`,
    },
  ],
  plumbing: [
    {
      id: "winter-freeze-watch",
      season: "winter",
      months: [11, 12, 1, 2],
      match: /pipe|leak|freeze|insulat|slab|emergency/i,
      heading: "Freeze season watch",
      body: ({ facts, service, city }) =>
        `The first hard freeze finds every marginal pipe in a house in the same week. ${facts.business_name} lists ${service} among its work in ${city} — the slow drip, the cabinet under the back faucet, the line through the garage: all cheaper to look at before the cold, not during it.`,
    },
    {
      id: "spring-water-check",
      season: "spring",
      months: [3, 4, 5],
      match: /water heater|leak|drain|inspect|maintenance/i,
      heading: "Spring is a plumbing season too",
      body: ({ facts, service, city }) =>
        `Winter is hard on a house's water side, and it shows in spring: a water heater that worked overtime, lines that shrank and swelled, outdoor taps waking up. ${facts.business_name} lists ${service} among its work in ${city}, and the thaw is a fair moment to walk the house with a professional eye.`,
    },
  ],
  roofing: [
    {
      id: "storm-season-check",
      season: "spring",
      months: [3, 4, 5, 6],
      match: /inspect|repair|storm|maintenance|roof/i,
      heading: "Storm season asks its question early",
      body: ({ facts, service, city }) =>
        `Hail and straight-line winds do not check the calendar, but they do have a season — and the roofs that fare best were looked at before it. ${facts.business_name} lists ${service} among its work in ${city}; a pre-season look at flashing, penetrations and the last storm's leftovers is the whole idea.`,
    },
    {
      id: "fall-winter-prep",
      season: "fall",
      months: [9, 10, 11],
      match: /inspect|repair|gutter|maintenance|shingle/i,
      heading: "Before the wet season sits on it",
      body: ({ facts, service, city }) =>
        `A roof spends winter doing its job under the worst conditions of the year. ${facts.business_name} lists ${service} among its work in ${city} — fall is when a lifted shingle or a tired seal still costs minutes to put right instead of a ceiling.`,
    },
  ],
  landscaping: [
    {
      id: "spring-cleanup",
      season: "spring",
      months: [3, 4, 5],
      match: /clean|maintenance|mulch|spring|mow|bed/i,
      heading: "The yard wakes up first",
      body: ({ facts, service, city }) =>
        `Everything a yard did last year is still lying on it in March. ${facts.business_name} lists ${service} among its work in ${city} — the spring cleanup that clears the winter off is also what lets the growing season start from a bed worth looking at.`,
    },
    {
      id: "summer-maintenance",
      season: "summer",
      months: [6, 7, 8],
      match: /mow|lawn|maintenance|irrigation|watering|trim/i,
      heading: "Keeping pace with the growing season",
      body: ({ facts, service, city }) =>
        `Summer does not reward the big push; it rewards the week that does not skip. ${facts.business_name} lists ${service} among its work in ${city} — steady maintenance through the heat is what a yard actually responds to.`,
    },
    {
      id: "fall-cleanup",
      season: "fall",
      months: [9, 10, 11],
      match: /clean|leaf|mulch|maintenance|aerat|seed/i,
      heading: "Put the beds down easy for winter",
      body: ({ facts, service, city }) =>
        `The fall cleanup decides how the yard meets spring: leaves left to mat, or beds cut back and mulched before the frost. ${facts.business_name} lists ${service} among its work in ${city}, and this is its season.`,
    },
  ],
  fencing: [
    {
      id: "spring-build-window",
      season: "spring",
      months: [3, 4, 5, 6],
      match: /install|build|new|replace|fence/i,
      heading: "Ground is workable again",
      body: ({ facts, service, city }) =>
        `A fence is set in the ground, so the ground sets the calendar: the spring window is when posts go in easily and the line has all season to settle before the next freeze. ${facts.business_name} lists ${service} among its work in ${city}.`,
    },
    {
      id: "storm-repair-window",
      season: "late-summer",
      months: [7, 8, 9],
      match: /repair|fix|fence|gate/i,
      heading: "Storm damage ages badly",
      body: ({ facts, service, city }) =>
        `A leaning section after a summer storm does not lean back. ${facts.business_name} lists ${service} among its work in ${city} — a repaired line before the wet season is a fence that survives it.`,
    },
  ],
  electrical: [
    {
      id: "summer-load-check",
      season: "summer",
      months: [5, 6, 7, 8],
      match: /panel|inspect|upgrade|maintenance|outlet/i,
      heading: "Peak-load season",
      body: ({ facts, service, city }) =>
        `AC season is also the season a panel carries its heaviest load. ${facts.business_name} lists ${service} among its work in ${city} — the warm-summer check that keeps breakers boring.`,
    },
    {
      id: "holiday-lighting-prep",
      season: "fall",
      months: [10, 11],
      match: /outlet|lighting|outdoor|inspect|install/i,
      heading: "Before the lights go up",
      body: ({ facts, service, city }) =>
        `Outdoor outlets that idled all year carry the holiday load next. ${facts.business_name} lists ${service} among its work in ${city} — worth a look before the ladder comes out, not after.`,
    },
  ],
};

/**
 * seasonalCards({ industry, services, now, max }) ->
 *   { enabled, vertical, month, cards, reason }
 *
 * cards = catalog cards whose month window contains the build month AND whose
 * `match` regex hits the business's own service list. A month window with no
 * matching certified service produces NO card — that is law 2 doing its work.
 */
function seasonalCards({ industry, services = [], now = new Date(), max = 2 } = {}) {
  const month = now instanceof Date && Number.isFinite(now.getTime())
    ? now.getMonth() + 1
    : Math.max(1, Math.min(12, Number(now) || 1));
  const vertical = verticalFor(industry);
  if (!vertical) return { enabled: true, vertical: null, month, cards: [], reason: "no_vertical_for_industry" };
  const candidates = (SEASONAL_CATALOG[vertical] || []).filter((c) => c.months.includes(month));
  if (!candidates.length) return { enabled: true, vertical, month, cards: [], reason: "no_season_this_month" };
  const cards = candidates
    .map((c) => ({ ...c, service: certifiedService(services, c.match) }))
    .filter((c) => c.service)
    .slice(0, Math.max(1, max));
  return {
    enabled: true,
    vertical,
    month,
    cards,
    reason: cards.length ? "" : "no_certified_service_matches",
  };
}

// Merchandising language the catalog must never grow and the rendered section
// must never carry. Local to this module: the SEO-page claim scanner has its
// own (stricter, first-person-inclusive) list for a different surface.
const MERCH_BANNED = [
  [/\$\s?\d/, "price figure"],
  [/%\s*off/i, "discount claim"],
  [/\bfree\b/i, "free offer"],
  [/\bdiscount\b|\bcoupon\b|\bpromo(?!te)\b|\bspecial offer\b|\bdeal\b/i, "offer claim"],
  [/\blimited time\b|\bact now\b|\bexpires\b|\bhurry\b/i, "urgency claim"],
  [/\bguarantee|\bwarrant(y|ied|ies)\b/i, "guarantee claim"],
  [/\b24\s*\/\s*7\b|\b24 hours\b/i, "availability claim"],
  [/\bsame[- ]day\b|\bnext[- ]day\b/i, "response-time claim"],
  [/\bcall (?:now|today)\b/i, "pushy CTA"],
  [/\b(?:we|our|us)\b/i, "first-person claim"],
];

/**
 * Prove the rendered section over its BYTES: every rendered card names a
 * service that is on the business's certified list, and no merchandising
 * language survived rendering. Throws — the engine treats a throw here the
 * same as any gate failure.
 */
function assertSeasonalCopyCertified({ html, cards, services }) {
  const text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  if (!cards || !cards.length) {
    if (text.trim()) throw new Error("seasonal refused: an empty selection must render an empty section");
    return true;
  }
  for (const card of cards) {
    const certified = certifiedService(services, card.match);
    if (!certified || certified !== card.service) {
      throw new Error(`seasonal refused: card '${card.id}' is not bound to a service the business lists`);
    }
    if (!text.includes(card.service)) {
      throw new Error(`seasonal refused: card '${card.id}' rendered without its certified service name`);
    }
  }
  for (const [re, label] of MERCH_BANNED) {
    const m = text.match(re);
    if (m) throw new Error(`seasonal refused: ${label} — found "${m[0].trim()}"`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Render — the site's own palette, scoped styles, no scripts
// ---------------------------------------------------------------------------
const SECTION_CSS = `
.wss-seasonal{box-sizing:border-box;max-width:1160px;margin:0 auto;padding:1.5rem 1.25rem 2.5rem;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wss-seasonal *{box-sizing:inherit}
.wss-seasonal__head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}
.wss-seasonal__eyebrow{font-size:.75rem;letter-spacing:.14em;text-transform:uppercase;color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)));margin:0;font-weight:700}
.wss-seasonal__title{font-size:1.35rem;line-height:1.25;margin:0;color:inherit}
.wss-seasonal__grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.wss-seasonal__card{border:1px solid color-mix(in srgb,hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%))) 35%,transparent);border-radius:12px;padding:1.1rem 1.2rem;background:transparent}
.wss-seasonal__card h3{margin:0 0 .5rem;font-size:1.02rem;line-height:1.3;color:inherit}
.wss-seasonal__card p{margin:0 0 .9rem;font-size:.92rem;line-height:1.55;opacity:.88}
.wss-seasonal__card a{display:inline-block;font-size:.9rem;font-weight:700;color:hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)));text-decoration:none;border:1px solid hsl(var(--wss-accent-hsl,var(--accent,8 61% 40%)));border-radius:8px;padding:.5rem .9rem}
@media (prefers-reduced-motion:no-preference){.wss-seasonal__card a:hover{filter:brightness(1.08)}}
`;

function cardHtml(card, { facts }) {
  const city = facts.city || "";
  const text = card.body({ facts, service: card.service, city });
  const digits = String(facts.phone_digits || facts.phone || "").replace(/\D/g, "");
  const cta = digits
    ? `<a href="tel:${esc(digits)}">Call${facts.phone ? ` ${esc(facts.phone)}` : ""}</a>`
    : "";
  return `<article class="wss-seasonal__card" data-wss-seasonal="${esc(card.id)}" data-wss-season="${esc(card.season)}">
<h3>${esc(card.heading)}</h3>
<p>${esc(text)}</p>
${cta}
</article>`;
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[c]));
}

/** The full section HTML, or "" when the selection is empty. */
function renderSeasonalSection({ facts, selection }) {
  if (!selection || !selection.cards || !selection.cards.length) return "";
  const cards = selection.cards;
  const grid = cards.map((c) => cardHtml(c, { facts })).join("\n");
  return `<style>${SECTION_CSS}</style>
<section class="wss-seasonal" aria-label="Seasonal notes" data-wss-seasonal-vertical="${esc(selection.vertical)}">
<div class="wss-seasonal__head">
<p class="wss-seasonal__eyebrow">This season at ${esc(facts.business_name || "")}</p>
</div>
<div class="wss-seasonal__grid">
${grid}
</div>
</section>`;
}

/**
 * The engine seam. Given the composed index.html and the request's verified
 * facts, renders the seasonal section into the page — but ONLY when
 * facts.features.seasonal is EXACTLY true (default off), the industry maps to
 * a vertical, the build month is in a card's window, and a certified service
 * matches. Any other case returns the html untouched with a report saying why.
 *
 * -> { html, report: { enabled, rendered, vertical, month, cards, reason } }
 */
function injectSeasonalSection({ html, facts = {}, services = [], now = new Date() } = {}) {
  const enabled = Boolean(facts && facts.features && facts.features.seasonal === true);
  if (!enabled) {
    return { html, report: { enabled: false, rendered: false, vertical: null, month: null, cards: [], reason: "flag_off" } };
  }
  const selection = seasonalCards({ industry: facts.industry, services, now });
  const section = renderSeasonalSection({ facts, selection });
  if (!section) {
    return { html, report: { enabled: true, rendered: false, vertical: selection.vertical, month: selection.month, cards: [], reason: selection.reason } };
  }
  assertSeasonalCopyCertified({ html: section, cards: selection.cards, services });
  if (!/<\/body>/i.test(String(html))) {
    return { html, report: { enabled: true, rendered: false, vertical: selection.vertical, month: selection.month, cards: [], reason: "no_body_close_tag" } };
  }
  const out = String(html).replace(/<\/body>/i, `${section}\n</body>`);
  return {
    html: out,
    report: {
      enabled: true,
      rendered: true,
      vertical: selection.vertical,
      month: selection.month,
      cards: selection.cards.map((c) => c.id),
      reason: "",
    },
  };
}

module.exports = {
  SEASONAL_CATALOG,
  verticalFor,
  seasonalCards,
  renderSeasonalSection,
  assertSeasonalCopyCertified,
  injectSeasonalSection,
  certifiedService,
  MERCH_BANNED,
  FLAG_PATH,
};
