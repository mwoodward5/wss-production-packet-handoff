// LeadMiner opportunity scoring — find businesses with MONEY but a BAD website.
//
// Core thesis (Mark's): a poor website + high reviews + strong Google rating =
// they do real volume (so they have cash) but nobody's built them a good site.
// That's the sweet spot. This formalizes and extends it into a 0-100 score with
// human-readable reasons (the pitch hooks) and disqualifiers. Pure function.

const HIGH_TICKET = /roof|hvac|remodel|masonry|landscap|concrete|pool|solar|foundation|paver|hardscape|kitchen|bath|excavat|fence|deck/i;
const MID_TICKET  = /plumb|electric|tree|paint|garage|window|gutter|drywall|flooring|septic|well/i;
const BUILDER     = /wix|godaddy|weebly|squarespace|site123|business\.site|wordpress\.com/i;
const CHAIN       = /\b(inc\.? #|franchise| llc #|servpro|roto-rooter|molly maid|the home depot|lowe'?s)\b/i;

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// demand = real customer volume (money proxy). Reviews dominate, rating gates,
// recency confirms they're active NOW.
function demandScore(b) {
  const rc = Number(b.reviewCount || 0);
  const volume = Math.min(100, Math.log10(rc + 1) * 45); // 10→45, 100→90, 1000→100
  const rating = Number(b.rating || 0);
  const ratingGate = rating >= 4.5 ? 1 : rating >= 4.0 ? 0.85 : rating >= 3.5 ? 0.6 : 0.3;
  const recency = b.reviewRecencyDays == null ? 0.85 : b.reviewRecencyDays <= 30 ? 1 : b.reviewRecencyDays <= 120 ? 0.85 : 0.6;
  return clamp(volume * ratingGate * recency);
}

// weakness = how bad the current web presence is (the opening).
function weaknessScore(b) {
  const w = b.website || {};
  if (!w.exists) return 70;                 // no site = clear need (but harder to enrich/convert)
  if (w.status && w.status >= 400) return 95; // broken/dead site
  let s = 20;
  if (w.https === false) s += 12;
  if (w.mobile === false) s += 18;
  if (w.thin) s += 12;
  if (w.hasSchema === false) s += 8;
  if (w.hasReviews === false) s += 6;
  if (BUILDER.test(w.builder || "")) s += 15;   // DIY builder = upgradeable
  if (w.loadMs && w.loadMs > 4000) s += 10;
  if (w.ageYears && w.ageYears >= 4) s += 8;
  if (w.modernPremium) s = Math.min(s, 10);      // already has a great site = not our buyer
  return clamp(s);
}

// affordability = margin to spend. High-ticket trades + ad spend + breadth.
function affordabilityMultiplier(b) {
  let m = 1.0;
  if (HIGH_TICKET.test(b.category || "")) m += 0.35;
  else if (MID_TICKET.test(b.category || "")) m += 0.15;
  if (b.runningAds) m += 0.2;                       // already pays to be seen
  if (b.gbpClaimed) m += 0.1;                       // invests in online presence
  if ((b.serviceAreaCount || 0) >= 3) m += 0.1;     // multi-area = bigger op
  return Math.min(1.8, m);
}

export function scoreLead(b = {}) {
  const reasons = [];
  const disqualifiers = [];

  if (CHAIN.test(b.name || "") || b.franchise) disqualifiers.push("national_chain_or_franchise");
  if (Number(b.reviewCount || 0) < 5) disqualifiers.push("unproven_demand_under_5_reviews");
  if (Number(b.rating || 0) && Number(b.rating) < 3.0) disqualifiers.push("reputation_problem_hard_sell");
  if ((b.website || {}).modernPremium) disqualifiers.push("already_has_premium_site");

  const demand = demandScore(b);
  const weakness = weaknessScore(b);
  const afford = affordabilityMultiplier(b);

  // Sweet spot: BOTH high demand AND weak site. Geometric-ish mean so a zero on
  // either axis tanks the score (a great site with tons of reviews ≠ opportunity;
  // a terrible site with no customers ≠ money).
  let score = Math.sqrt(demand * weakness) * afford;
  score = clamp(Math.round(score));
  if (disqualifiers.length) score = Math.min(score, 25);

  // pitch hooks
  if (demand >= 70) reasons.push(`Strong demand — ${b.reviewCount} reviews at ${b.rating}★ means real, paying volume`);
  if (weakness >= 60) reasons.push("Weak/outdated web presence — big gap between their reputation and their site");
  if (HIGH_TICKET.test(b.category || "")) reasons.push("High-ticket trade — margin to invest in a better site");
  if (b.runningAds) reasons.push("Already spends on ads — pays to be found, but the site underdelivers");
  if ((b.website || {}).status >= 400 || !(b.website || {}).exists) reasons.push("Site is broken or missing — nothing capturing the demand they're earning");

  const contactable = Boolean(b.hasEmail);
  return {
    score,
    tier: score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D",
    demand: Math.round(demand), weakness: Math.round(weakness), affordability: Number(afford.toFixed(2)),
    contactable, lane: contactable ? "email" : "call_or_sms",
    reasons: reasons.slice(0, 4),
    disqualifiers,
  };
}

// The trade a lead belongs to, normalized. This is what the spread rotates
// across, so it has to be the same string a caller filed the lead under —
// `category` is the mining vertical ("plumbing", "hvac", …) on a mined row.
function industryKey(lead = {}) {
  return String(lead.category || "").toLowerCase().replace(/\s+/g, " ").trim() || "(unspecified)";
}

// The priority order WITHIN a trade: best opportunity first, contactable ahead
// of an equal-scoring uncontactable lead (email is the cheapest channel).
const bySelectionRank = (a, z) =>
  (z.opportunity.score - a.opportunity.score) ||
  (Number(z.opportunity.contactable) - Number(a.opportunity.contactable));

// Rank a mined batch and take the top N. Dedupe by place_id, drop disqualified
// from the priority set (kept but not selected), prefer contactable for email.
//
// TWO SELECTION MODES, because a single global sort is wrong the moment a run
// spans more than one trade:
//
//   · "global" — the original behaviour. Sort every eligible lead by score and
//     take the top N. Correct when the pool is a single trade.
//   · "spread" — round-robin across the DISTINCT trades present, taking the best
//     remaining lead from each in turn. Mine 10 across 5 trades = 2 each; Mine
//     100 across 10 = 10 each.
//
// WHY SPREAD IS THE DEFAULT WHEN >1 TRADE IS PRESENT. selectTop is trade-blind:
// it ranks by score alone, so the densest vertical in the metro — plumbing,
// always — fills the whole run. "Mine 10" across five trades came back ten
// plumbers. The scorer has no idea a lead is a plumber; the FIX is to make the
// selection trade-aware here rather than to re-weight the score (which would
// just move the distortion).
//
// A THIN TRADE IS REPORTED, NEVER BACKFILLED. When a trade runs dry before its
// share is filled, the run comes up SHORT and says so (`shortfall`, `ranDry`).
// Topping the run back up to N from the densest trade is the exact behaviour
// spread exists to stop — an honest "8 of 10, electrician ran dry" beats ten
// rows that are secretly six plumbers again.
//
// `opts.spread`: force spread on/off. Undefined = auto (spread when >1 trade).
export function selectTop(leads = [], n = 100, { spread } = {}) {
  const seen = new Set();
  const scored = [];
  for (const b of leads) {
    const key = b.place_id || (b.name || "") + (b.address || "");
    if (seen.has(key)) continue; seen.add(key);
    scored.push({ ...b, opportunity: scoreLead(b) });
  }
  const eligible = scored
    .filter((s) => s.opportunity.disqualifiers.length === 0)
    .sort(bySelectionRank);

  // Group eligible leads by trade, each bucket already in priority order.
  const groups = new Map();
  for (const lead of eligible) {
    const key = industryKey(lead);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }
  const availableByIndustry = new Map([...groups].map(([key, list]) => [key, list.length]));

  const distinctIndustries = groups.size;
  const useSpread = spread === undefined ? distinctIndustries > 1 : Boolean(spread);
  const wantN = Math.max(0, Math.trunc(Number(n) || 0));

  let selected;
  if (!useSpread || distinctIndustries <= 1) {
    // GLOBAL. Identical to the old behaviour — and identical to spread when
    // there is only one trade, so a single-trade pool is unaffected either way.
    selected = eligible.slice(0, wantN);
  } else {
    // SPREAD. Deal N as EVEN SHARES across the trades, then round-robin up to
    // each trade's share — never past it. The per-trade cap is the whole point:
    // it is what stops a thin trade's deficit being quietly covered by more
    // plumbers. Mine 4 across {plumbing:10, electrician:1} yields 2 + 1 = 3 and
    // reports one short, NOT 3 plumbers + 1 electrician. Backfilling from the
    // densest trade is the exact behaviour the owner rejected ("that is
    // definitely not multi-category").
    //
    // Order is stable and deterministic — strongest trade first — so when N does
    // not divide evenly the +1 shares land on the strongest verticals, and the
    // round-robin interleaves the picks rather than blocking one trade together.
    const order = [...groups.entries()]
      .sort((a, z) => (z[1][0].opportunity.score - a[1][0].opportunity.score) || a[0].localeCompare(z[0]))
      .map(([key]) => key);
    const trades = order.length;
    const base = Math.floor(wantN / trades);
    const extra = wantN % trades;                    // the strongest `extra` trades get one more
    const cap = new Map(order.map((key, j) => [key, base + (j < extra ? 1 : 0)]));
    const taken = new Map(order.map((key) => [key, 0]));
    selected = [];
    let progressed = true;
    while (selected.length < wantN && progressed) {
      progressed = false;
      for (const key of order) {
        if (selected.length >= wantN) break;
        if (taken.get(key) >= cap.get(key)) continue; // never exceed the even share
        const bucket = groups.get(key);
        if (bucket && bucket.length) {
          selected.push(bucket.shift());
          taken.set(key, taken.get(key) + 1);
          progressed = true;
        }
      }
    }
  }

  // Per-trade accounting, so a short run reads as a deliberate spread and not as
  // a thin metro. `available` is the eligible count BEFORE selection; `selected`
  // is what actually made the cut.
  const selectedByIndustry = new Map();
  for (const lead of selected) {
    const key = industryKey(lead);
    selectedByIndustry.set(key, (selectedByIndustry.get(key) || 0) + 1);
  }
  const industries = [...availableByIndustry.entries()]
    .map(([industry, available]) => ({ industry, available, selected: selectedByIndustry.get(industry) || 0 }))
    .sort((a, z) => (z.selected - a.selected) || (z.available - a.available) || a.industry.localeCompare(z.industry));

  const shortfall = Math.max(0, wantN - selected.length);
  // A trade "ran dry" only when spread wanted more from it and it had no more to
  // give — every eligible lead in it was taken while the run still came up short.
  const ranDry = useSpread && shortfall > 0
    ? industries.filter((it) => it.selected === it.available && it.available > 0).map((it) => it.industry)
    : [];

  return {
    selected,
    scoredCount: scored.length,
    eligibleCount: eligible.length,
    requested: wantN,
    mode: useSpread && distinctIndustries > 1 ? "spread" : "global",
    industries,
    shortfall,
    ranDry,
  };
}
