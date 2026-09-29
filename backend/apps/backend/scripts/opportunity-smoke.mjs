import { scoreLead, selectTop } from "../asset-pipeline/opportunity-score.mjs";
import assert from "node:assert";

const leads = [
  { name: "Richard Diaz Landscape & Masonry", place_id: "rd", category: "landscape masonry", rating: 4.9, reviewCount: 33, reviewRecencyDays: 20, hasEmail: true, gbpClaimed: true,
    website: { exists: true, status: 200, https: true, mobile: false, thin: true, hasSchema: false, hasReviews: false, builder: "wordpress", ageYears: 4 } },
  { name: "BigBox Franchise #4412", place_id: "bb", category: "roofing", rating: 4.2, reviewCount: 900, hasEmail: true, franchise: true,
    website: { exists: true, status: 200, https: true, mobile: true, modernPremium: true } },
  { name: "Brand New HVAC LLC", place_id: "nh", category: "hvac", rating: 5.0, reviewCount: 2, hasEmail: true,
    website: { exists: false } },
  { name: "Slick Modern Remodel Co", place_id: "sm", category: "remodel", rating: 4.8, reviewCount: 210, reviewRecencyDays: 10, hasEmail: true,
    website: { exists: true, status: 200, https: true, mobile: true, hasSchema: true, hasReviews: true, modernPremium: true } },
  { name: "Busy Roofers No Site", place_id: "br", category: "roofing", rating: 4.7, reviewCount: 140, reviewRecencyDays: 15, hasEmail: false, gbpClaimed: true, runningAds: true,
    website: { exists: false } },
];

const r = selectTop(leads, 3);
const byName = Object.fromEntries(leads.map(l => [l.place_id, scoreLead(l)]));

console.log("scores:");
for (const l of leads) { const s = byName[l.place_id]; console.log(`  ${s.tier} ${String(s.score).padStart(3)}  ${l.name}  (demand ${s.demand}/weak ${s.weakness}/afford ${s.affordability}) ${s.disqualifiers.join(",")||""}`); }

// Richard = high demand + weak site + high ticket → top tier A/B, contactable email
assert(byName.rd.score >= 55, "Richard should score B+ (real demand, weak site)");
assert(byName.rd.contactable && byName.rd.lane === "email", "Richard routes to email");
// Franchise + premium site → disqualified/low
assert(byName.bb.disqualifiers.includes("national_chain_or_franchise"), "chain disqualified");
assert(byName.bb.score <= 25, "chain scored low");
// New business, 2 reviews → unproven, low
assert(byName.nh.disqualifiers.includes("unproven_demand_under_5_reviews"), "2-review biz disqualified");
// Premium modern site → low opportunity even with reviews
assert(byName.sm.score <= 30, "already-great site = low opportunity");
// Busy roofer no site + ads → high but routes to call (no email)
assert(byName.br.score >= 45, "busy no-site roofer scores well");
assert(byName.br.lane === "call_or_sms", "no-email lead routes to call/SMS");
// Selection excludes disqualified
assert(!r.selected.find(s => s.place_id === "bb" || s.place_id === "nh"), "top set excludes disqualified");

console.log("\ntop selected:", r.selected.map(s => `${s.name} (${s.opportunity.score})`).join("  |  "));

// ---------------------------------------------------------------------------
// TRADE SPREAD. selectTop must round-robin across the distinct trades so one
// dense vertical (plumbing) cannot fill a run. "Mine 10 returned TEN plumbers"
// is the bug this closes.
// ---------------------------------------------------------------------------
const trade = (category, i) => ({
  place_id: `${category}-${i}`, name: `${category} co ${i}`, category,
  rating: 4.6, reviewCount: 60 - i, reviewRecencyDays: 20, hasEmail: true,
  website: { exists: true, status: 200, https: true, mobile: false, thin: true, builder: "wix" },
});
const tally = (res) => res.selected.reduce((m, s) => (m[s.category] = (m[s.category] || 0) + 1, m), {});

// 1. A mixed pool yields an EVEN spread. Five trades, three each, Mine 10 -> 2 each.
const trades = ["plumbing", "hvac", "roofing", "electrician", "landscaping"];
const spread = selectTop(trades.flatMap(t => [0, 1, 2].map(i => trade(t, i))), 10);
assert(spread.mode === "spread", "more than one trade -> spread mode by default");
assert(spread.selected.length === 10, "spread filled the request");
for (const t of trades) assert(tally(spread)[t] === 2, `expected 2 ${t}, got ${tally(spread)[t]}`);
assert(spread.shortfall === 0, "an even, deep pool has no shortfall");

// 2. A single-trade pool still works, exactly like the old global sort.
const solo = selectTop([0, 1, 2, 3, 4].map(i => trade("plumbing", i)), 3);
assert(solo.mode === "global", "one trade -> global mode");
assert(solo.selected.length === 3 && solo.selected.every(s => s.category === "plumbing"), "single-trade pool selects that trade");

// 3. A thin trade REPORTS SHORT and is NOT backfilled from the dense trade.
//    plumbing:10, electrician:1, Mine 4 -> 2 + 1 = 3, one short. Plumbing is
//    capped at its even share (2); it never grows to 3 to cover electrician.
const thin = [...Array(10)].map((_, i) => trade("plumbing", i)).concat([trade("electrician", 0)]);
const thinRes = selectTop(thin, 4);
assert(tally(thinRes).plumbing === 2, `plumbing must stay at its even share, got ${tally(thinRes).plumbing}`);
assert(tally(thinRes).electrician === 1, "electrician contributes all it has");
assert(thinRes.selected.length === 3 && thinRes.shortfall === 1, "the run is honestly one short");
assert(thinRes.ranDry.join(",") === "electrician", "the dry trade is named");

console.log("spread:", JSON.stringify(tally(spread)), "| thin:", JSON.stringify(tally(thinRes)), "short", thinRes.shortfall, "dry", thinRes.ranDry);
console.log("PASS — opportunity scoring");
