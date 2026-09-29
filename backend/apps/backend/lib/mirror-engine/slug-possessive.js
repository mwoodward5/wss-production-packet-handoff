'use strict';
/*
 * slug-possessive.cjs — v2 (teacher-authored after round-1 adversarial review)
 * Client-isolation slug coherence. TRUTH GATE: a false pass shows one client's
 * data on another client's site. Rules learned the hard way:
 *   - exact token equality is the only identity evidence that counts alone;
 *   - a truncated slug tail ("...-sew" for "Sewer") may prefix-match ONLY when
 *     at least one OTHER exact token already matched (kills heat/Heather,
 *     york/Yorktown — they share nothing else);
 *   - never throws on anything, including hostile getters/proxies.
 */
const STOP = new Set(["the", "and", "of", "inc", "llc", "co", "tx", "test", "wss", "&"]);


const TRADE_WORDS = new Set(["plumbing","plumber","hvac","heating","cooling","air","conditioning",
  "concrete","roofing","roofer","landscaping","lawn","fence","fencing","electric","electrical",
  "tattoo","tattoos","salon","spa","medspa","med","construction","contracting","contractors",
  "contractor","services","service","sewer","drain","water","repair","repairs","tree","care",
  "excavation","pumping","mechanical","comfort","home","homes"]);

function collapse(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || STOP.has(t)) continue;
    // possessive split: a lone "s" following a token that itself ends in "s"
    // ("sal","s") collapses into the singular already emitted — skip the "s".
    if (t === "s" && out.length && /[a-z]s$/.test(out[out.length - 1])) continue;
    if (t.length >= 2) out.push(t);
  }
  return out;
}

function tokenize(text) {
  return collapse(String(text == null ? "" : text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function slugTokens(slug) {
  return collapse(String(slug == null ? "" : slug).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function nameTokens(businessName) {
  const raw = String(businessName == null ? "" : businessName).toLowerCase().replace(/[\u2019']s\b/g, "");
  return collapse(raw.split(/[^a-z0-9]+/).filter(Boolean));
}

function cityTokens(city) {
  return collapse(String(city == null ? "" : city).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

// Prefix evidence: ONLY the slug's final token may prefix-match an identity
// token (slug truncation), it must be >=3 chars, and it only ever ADDS to
// already-matched exact evidence — never substitutes for it.
function truncationShared(slugToks, idToks) {
  if (!slugToks.length) return [];
  const last = slugToks[slugToks.length - 1];
  if (last.length < 3) return [];
  return idToks.filter((t) => t !== last && t.startsWith(last)).map((t) => `${last}~${t}`);
}

function coherent(input) {
  try {
    const safe = input && typeof input === "object" ? input : {};
    const sT = slugTokens(safe.slug == null ? "" : safe.slug);
    const nT = nameTokens(safe.businessName == null ? "" : safe.businessName);
    const cT = cityTokens(safe.city == null ? "" : safe.city);
    if (!sT.length || (!nT.length && !cT.length)) {
      return { ok: false, sharedTokens: [], rule: "insufficient_input" };
    }
    const nameExact = nT.filter((tok) => sT.includes(tok));
    // identity evidence: a non-trade token, or >=2 exact tokens together.
    // A lone trade word ("concrete") names the CATEGORY, not the business.
    const identity = nameExact.filter((tok) => !TRADE_WORDS.has(tok));
    if (identity.length >= 1 || nameExact.length >= 2) {
      const extra = truncationShared(sT, nT);
      return { ok: true, sharedTokens: [...nameExact, ...extra], rule: "name_token" };
    }
    const cityExact = cT.filter((tok) => sT.includes(tok));
    if (cityExact.length >= 1) {
      return { ok: true, sharedTokens: cityExact, rule: "city_token" };
    }
    return { ok: false, sharedTokens: [], rule: "no_shared_token" };
  } catch {
    return { ok: false, sharedTokens: [], rule: "insufficient_input" };
  }
}

module.exports = { slugTokens, nameTokens, cityTokens, slugCoherent: coherent };

/* ---------------- self-test ---------------- */
if (process.argv.includes("--test")) {
  const t = require("node:assert");
  const cases = [];
  const ok = (name, fn) => { try { fn(); cases.push(`PASS ${name}`); } catch (e) { cases.push(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

  ok("production possessive case passes via exact name tokens", () => {
    const r = coherent({ slug: "wss-test-sal-s-heating-and-cooling-plumbing-and-sew", businessName: "Sal's Heating & Cooling, Plumbing & Sewer", city: "Louisville" });
    t.equal(r.ok, true); t.equal(r.rule, "name_token");
    t.ok(r.sharedTokens.includes("sal") && r.sharedTokens.includes("heating") && r.sharedTokens.includes("plumbing"));
  });
  ok("truncated slug tail counts only with other exact evidence", () => {
    const r = coherent({ slug: "wss-test-sewer-services-plumbing-sew", businessName: "Sewer Services Plumbing", city: "Dallas" });
    t.equal(r.ok, true);
  });
  ok("REVIEW DEFECT 1: heat does NOT match Heather", () => {
    const r = coherent({ slug: "heat", businessName: "Heather Roofing", city: "Louisville" });
    t.equal(r.ok, false);
  });
  ok("REVIEW DEFECT 2: york does NOT match Yorktown alone", () => {
    const r = coherent({ slug: "york", businessName: "Acme Plumbing", city: "Yorktown" });
    t.equal(r.ok, false);
  });
  ok("different business refused", () => {
    const r = coherent({ slug: "wss-test-mikes-plumbing-dallas", businessName: "Sal's Heating & Cooling", city: "Louisville" });
    t.equal(r.ok, false);
  });
  ok("city token alone establishes coherence", () => {
    const r = coherent({ slug: "houston-concrete-pros", businessName: "Bob's Concrete Kings", city: "Houston" });
    t.equal(r.ok, true); t.equal(r.rule, "city_token");
  });
  ok("REVIEW DEFECT 4/5: hostile getters never throw", () => {
    const r = coherent({ get slug() { throw new Error("boom"); } });
    t.equal(r.ok, false); t.equal(r.rule, "insufficient_input");
    const r2 = coherent(new Proxy({}, { get() { throw new Error("boom"); } }));
    t.equal(r2.ok, false);
  });
  ok("empty inputs refused", () => {
    t.equal(coherent({}).ok, false);
    t.equal(coherent(null).ok, false);
  });
  ok("possessive collapse works both ways", () => {
    t.deepEqual(nameTokens("Sal's Heating"), ["sal", "heating"]);
    t.ok(slugTokens("wss-test-sal-s-heating").includes("sal"));
    t.ok(!slugTokens("wss-test-sal-s-heating").includes("s"));
  });
  for (const c of cases) console.log(c);
}
