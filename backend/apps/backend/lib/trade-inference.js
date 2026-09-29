"use strict";

// lib/trade-inference.js — what trade IS this business, really?
//
// THE INCIDENT. Every one of the three LeadMiner packets in the queue was
// labelled `industry: "plumber"`. One of them was M & M Heating & Cooling,
// whose own service list reads "AC Maintenance/Repair Services" and "Air
// Conditioner Installation". We built it a plumbing mirror, and the render
// gate correctly refused to publish it — after paying for the build.
//
// The label is the ONE field that lied. The services were right in all three
// cases, and they were sitting in the same packet the whole time. So the trade
// is DERIVED from what the business says it does, and the label is treated as
// a hint that can be overruled by evidence.
//
// AND MULTI-TRADE IS A FIRST-CLASS ANSWER. "Complete Plumbing, Electric & Air"
// is not a plumber with some stray words; it is three trades. This reports the
// mix so the caller can build on the LEAD trade's donor and let the client's
// verified service list carry the other trades onto the page (authority pages
// render one page per verified service, whatever its trade; the render gate
// exempts the client's own name/services/reviews). Refusing outright was the
// pre-authority-pages doctrine, retired 2026-08-20.

// Evidence terms per trade. Deliberately concrete service language — the words
// a business puts on its own service list — not vague category names.
const TRADE_TERMS = Object.freeze({
  plumbing: ["plumb", "drain clean", "water heater", "tankless", "sewer line", "clogged drain", "repipe", "leak detect", "faucet", "toilet", "garbage disposal", "backflow", "septic", "water line", "gas line"],
  hvac: ["hvac", "air condition", "ac repair", "ac install", "ac maintenance", "heating and cooling", "heating & cooling", "heating", "cooling", "furnace", "heat pump", "mini split", "ductwork", "duct clean", "thermostat", "air handler", "refrigerant"],
  electrical: ["electric", "electrical", "wiring", "rewire", "panel upgrade", "breaker", "outlet install", "lighting install", "generator install", "ev charger"],
  roofing: ["roof", "shingle", "re-roof", "reroof", "gutter", "flashing", "soffit", "fascia", "skylight"],
  // Bare "fencing" is deliberately absent. It names both a building trade and
  // a sword sport, so it cannot prove which one the business performs.
  fencing: ["fence", "gate install", "picket", "chain link", "vinyl fence", "wrought iron"],
  concrete: ["concrete", "driveway pour", "stamped concrete", "flat work", "flatwork", "slab", "laser screed", "sidewalk pour", "foundation pour"],
  landscaping: [
    "landscap", "lawn care", "lawn garden", "hardscap", "irrigation",
    "sod", "mulch", "tree trim", "tree service", "tree removal",
    "stump grinding", "arborist", "garden service", "gardening",
    "land clearing", "retaining wall", "sprinkler",
  ],
  "med spa": ["botox", "filler", "medspa", "med spa", "laser hair", "microneedling", "coolsculpt", "dermal", "hydrafacial", "injectable"],
  "hair salon": ["haircut", "hair color", "balayage", "highlights", "blowout", "keratin", "hair salon", "extensions", "manicure", "pedicure", "nail salon", "gel nails"],
  tattoo: ["tattoo", "piercing", "body art", "flash design", "cover-up tattoo"],
  restoration: ["water damage", "fire damage", "mold remediation", "mold mitigation", "restoration", "smoke damage", "flood cleanup"],
  "general contractor": [
    "general contract", "construction", "carpenter", "carpentry", "framing",
    "cabinetry", "cabinet install", "trim carpentry", "remodel",
    "home addition", "kitchen remodel", "bathroom remodel", "renovation",
  ],
  "real estate agent": ["real estate", "realtor", "realty", "listing agent", "buyer's agent", "buyers agent", "seller representation", "homes for sale", "property listing", "property management", "open house", "home valuation", "relocation services", "brokerage"],
});

const norm = (s) => String(s == null ? "" : s).toLowerCase();

const SPORT_FENCING_SIGNAL_PATTERNS = Object.freeze([
  ["club", /\bclub\b/],
  ["sword", /\bswords?\b/],
  ["sabre", /\bsab(?:re|er)s?\b/],
  ["foil", /\bfoils?\b/],
  ["epee", /\bepees?\b/],
  ["olympic", /\bolympi(?:c|an)s?\b/],
  ["coach", /\bcoach(?:es|ing)?\b/],
  ["classes", /\bclasses\b/],
  ["training", /\btraining\b/],
  ["footwork", /\bfootwork\b/],
  ["blade", /\bblades?\b/],
  ["athletes", /\bathletes\b/],
  ["sport", /\bsports?\b/],
]);

const FENCE_CONTRACTOR_SIGNAL_PATTERNS = Object.freeze([
  ["fence_company", /\bfenc(?:e|ing)\s+(?:company|co\b)/],
  ["fence_contractor", /\bfenc(?:e|ing)\s+contractor\b/],
  ["fence_installation", /\b(?:fence|fencing|gate)\s+install(?:ation|ations|er|ers|ing)?\b/],
  ["installs_fences", /\binstall(?:s|ed|ing)?\s+(?:a\s+)?(?:wood|vinyl|privacy|metal|iron|chain[- ]?link\s+)?fences?\b/],
  ["residential_fence", /\b(?:residential|commercial)\s+(?:fence|fencing)\b/],
  ["chain_link", /\bchain[- ]?link\b/],
  ["vinyl_fence", /\bvinyl\s+fenc(?:e|ing)\b/],
  ["wood_fence", /\bwood(?:en)?\s+fenc(?:e|ing)\b/],
  ["privacy_fence", /\bprivacy\s+fenc(?:e|ing)\b/],
  ["wrought_iron", /\bwrought\s+iron(?:\s+fenc(?:e|ing))?\b/],
  ["picket_fence", /\bpicket(?:\s+fenc(?:e|ing))?\b/],
  ["gate_installation", /\bgate\s+install(?:ation|ations|er|ers|ing)?\b/],
  ["contractor_gate", /\b(?:automatic|driveway|entry|security)\s+gates?\b|\bgates?\s+(?:installation|repair|fabrication)\b/],
  ["fence_material", /\b(?:cedar|aluminum|steel|metal|composite)\s+fenc(?:e|es|ing)\b|\bfenc(?:e|ing)\s+materials?\b/],
  ["field_fencing", /\b(?:sports?\s+)?fields?\s+fencing\b/],
  ["perimeter_fencing", /\bperimeter\s+fencing\b/],
]);

function normalizedEvidenceText(values) {
  return values
    .flat(Infinity)
    .map((value) => {
      if (value && typeof value === "object") {
        return value.name || value.title || value.displayName?.text || value.value || "";
      }
      return value;
    })
    .map((value) => norm(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " "))
    .join(" \n ");
}

function fencingVerticalVerdict({ intendedTrade = "", label = "", categories = [], businessName = "", services = [], siteText = "" } = {}) {
  const intended = norm(intendedTrade || label).trim();
  if (intended !== "fencing") return { ok: true, applicable: false, sportSignals: [], contractorSignals: [] };
  // Sport evidence is deliberately limited to the three owner-approved
  // surfaces. A contractor may truthfully list "sports field fencing" or a
  // "training facility perimeter" service; services must not indict it as a
  // sword club. Contractor corroboration may use those verified services.
  const sportText = normalizedEvidenceText([categories, businessName, siteText]);
  const contractorText = normalizedEvidenceText([label, categories, businessName, services, siteText]);
  const sportSignals = SPORT_FENCING_SIGNAL_PATTERNS
    .filter(([, pattern]) => pattern.test(sportText))
    .map(([signal]) => signal);
  const contractorSignals = FENCE_CONTRACTOR_SIGNAL_PATTERNS
    .filter(([, pattern]) => pattern.test(contractorText))
    .map(([signal]) => signal);
  if (sportSignals.length >= 2) {
    return {
      ok: false,
      applicable: true,
      reason: "vertical_mismatch_sport_fencing",
      sportSignals,
      contractorSignals,
    };
  }
  if (!contractorSignals.length) {
    return {
      ok: false,
      applicable: true,
      reason: "fencing_contracting_uncorroborated",
      sportSignals,
      contractorSignals,
    };
  }
  return { ok: true, applicable: true, sportSignals, contractorSignals };
}

function sportFencingGuardEnabled(env = process.env) {
  return String(env.GHOST_AGENCY_SPORT_FENCING_GUARD ?? "1").trim() !== "0";
}

/**
 * scoreTrades({ services, businessName, siteText }) -> [{ trade, hits, terms }]
 *
 * A hit is counted ONCE per term so a service list that repeats "water heater"
 * four times does not out-vote a business that genuinely does three things.
 * The business NAME counts double — "M & M Heating & Cooling" is a stronger
 * statement of trade than any single line item.
 */
function scoreTrades({ services = [], businessName = "", siteText = "" } = {}) {
  const serviceText = services
    .map((s) => norm(typeof s === "string" ? s : (s && (s.name || s.title))))
    .join(" \n ");
  const name = norm(businessName);
  const extra = norm(siteText);

  const out = [];
  for (const [trade, terms] of Object.entries(TRADE_TERMS)) {
    let hits = 0;
    const matched = [];
    for (const term of terms) {
      const contains = (text) => (trade === "fencing" && term === "fence")
        ? /\bfences?\b/.test(text)
        : text.includes(term);
      const inServices = contains(serviceText);
      const inName = contains(name);
      const inSite = contains(extra);
      if (!inServices && !inName && !inSite) continue;
      hits += inName ? 2 : 1;
      matched.push(term);
    }
    if (hits) out.push({ trade, hits, terms: matched });
  }
  return out.sort((a, b) => b.hits - a.hits);
}

/**
 * inferTrade({ label, services, businessName, siteText }) ->
 *   { trade, source, confident, multiTrade, secondary, scores, reason }
 *
 *   trade      — the trade to build for ("" when nothing is evident)
 *   source     — "derived" | "label" | "label_unsupported"
 *   multiTrade — true when a SECOND trade has real weight of its own. The
 *                caller builds on the LEAD trade's donor; the verified service
 *                list represents the rest (see the header note).
 *
 * The label wins only when evidence is silent or agrees with it. Evidence wins
 * when they disagree, because the services are what the business itself
 * published and the label is what a harvester guessed.
 */
function inferTrade({ label = "", services = [], businessName = "", siteText = "", categories = [], env = process.env } = {}) {
  const scores = scoreTrades({ services, businessName, siteText });
  const labelTrade = norm(label).trim();
  const fencingLabel = /\bfencing\b|\bfence\b/.test(labelTrade);
  const fencingDerived = scores[0]?.trade === "fencing";
  if ((fencingLabel || fencingDerived) && sportFencingGuardEnabled(env)) {
    const fencing = fencingVerticalVerdict({ intendedTrade: "fencing", label, categories, businessName, services, siteText });
    if (!fencing.ok) {
      return {
        trade: "", source: "label_unsupported", confident: false,
        multiTrade: false, secondary: [], scores,
        reason: fencing.reason,
        blocked: true,
        fencing,
      };
    }
  }
  const top = scores[0] || null;
  const second = scores[1] || null;

  // A second trade counts as REAL when it is at least half the leader's weight
  // and clears a floor — one stray word on a big service list is not a trade.
  const multiTrade = Boolean(top && second && second.hits >= 2 && second.hits >= top.hits * 0.5);

  if (!top) {
    return {
      trade: labelTrade, source: labelTrade ? "label" : "", confident: false,
      multiTrade: false, secondary: [], scores,
      reason: labelTrade ? "no service evidence; using the packet label" : "no trade evidence at all",
    };
  }

  const labelMatchesEvidence = labelTrade && scores.some((s) => s.trade === labelTrade);
  const trade = labelMatchesEvidence && labelTrade === top.trade ? labelTrade : top.trade;
  const source = labelMatchesEvidence && labelTrade === top.trade ? "label" : "derived";

  return {
    trade,
    source,
    confident: top.hits >= 2,
    multiTrade,
    secondary: scores.slice(1).filter((s) => s.hits >= 2).map((s) => s.trade),
    scores,
    reason: source === "derived" && labelTrade
      ? `packet said "${labelTrade}" but the services say "${top.trade}" (${top.terms.slice(0, 4).join(", ")})`
      : `services confirm "${trade}"`,
  };
}

module.exports = {
  inferTrade,
  scoreTrades,
  fencingVerticalVerdict,
  sportFencingGuardEnabled,
  TRADE_TERMS,
  SPORT_FENCING_SIGNAL_PATTERNS,
  FENCE_CONTRACTOR_SIGNAL_PATTERNS,
};
