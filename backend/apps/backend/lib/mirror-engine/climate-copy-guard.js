"use strict";

// lib/mirror-engine/climate-copy-guard.js — CLIMATE-SPECIFIC COPY STAYS IN
// ITS CLIMATE.
//
// AUDIT A1 (2026-09-03/04): the hvac-premier donor's literal hero headline
// "Cooling engineered for a 118-degree afternoon" shipped unchanged to West
// Michigan, Princeton NJ, and John's Island SC — 10/10 builds, one
// Phoenix-scale claim. The donor's <h1> carries no copy token, so no
// identity pass ever rewrites it; whatever a donor's author wrote as
// REGIONAL COLOR becomes every region's claim.
//
// This guard runs over the EMITTED pages, not the donor source: the hero
// h1, the title/description meta surface (title, meta description,
// og:*, twitter:*), alt attributes, and the hero region's own <p>/<span>
// text. A climate claim (a 3-digit-degree afternoon, "desert", "monsoon",
// "lake-effect", "nor'easter", an N%-humidity qualifier) may ship only to
// a build whose region belongs to that claim's climate; anywhere else it
// is replaced with a region-appropriate phrase from the set below, or the
// climate-neutral phrase when the region's climate is unknown.
//
// Provenance is recorded for the manifest as
//   copy_slot: { region_guard: { applied, pages, replacements:[…] } }
// so a later audit can tell a guarded headline from an authored one.
//
// Node 20+, CommonJS, zero npm deps. Fail-soft: any internal error leaves
// the page byte-identical with a named reason.

const { heroRegions } = require("./hero-media");
const { STATE_CODES } = require("./place-names");

/* ------------------------------------------------------------------ *
 * Climates
 * ------------------------------------------------------------------ */

// The climate classes this guard reasons about. Coarse on purpose: the
// claim vocabulary is coarse (three-digit heat, desert, monsoon,
// lake-effect snow), and a wrong-side-of-the-line call is harmless because
// the replacement phrases are themselves region-generic.
const CLIMATE_OF_STATE = {
  AZ: "desert", NV: "desert", NM: "desert", UT: "desert",
  TX: "hot_humid", FL: "hot_humid", LA: "hot_humid", MS: "hot_humid",
  AL: "hot_humid", GA: "hot_humid", SC: "hot_humid", NC: "hot_humid",
  TN: "hot_humid", AR: "hot_humid",
  MI: "humid_continental", WI: "humid_continental", MN: "humid_continental",
  IL: "humid_continental", IN: "humid_continental", IA: "humid_continental",
  OH: "humid_continental", MO: "humid_continental", KY: "humid_continental",
  WV: "humid_continental", PA: "humid_continental", NY: "humid_continental",
  NJ: "midatlantic", MD: "midatlantic", DE: "midatlantic", VA: "midatlantic",
  ME: "northeast", NH: "northeast", MA: "northeast", RI: "northeast",
  CT: "northeast",
  CO: "mountain", ID: "mountain", MT: "mountain", WY: "mountain",
  OK: "plains", KS: "plains", NE: "plains", SD: "plains", ND: "plains",
  CA: "pacific_med", WA: "pacific_med", OR: "pacific_med",
};

// Cities whose climate differs from their state default (kept deliberately
// tiny: only where the state class would license a wrong claim).
const CLIMATE_OF_CITY = {
  "elpaso": "desert", "tucson": "desert", "palmsprings": "desert",
  "lascruces": "desert",
};

function climateOf({ state = "", city = "" } = {}) {
  const cityKey = String(city || "").toLowerCase().replace(/[^a-z]/g, "");
  if (cityKey && CLIMATE_OF_CITY[cityKey]) return CLIMATE_OF_CITY[cityKey];
  const code = String(state || "").trim().toUpperCase();
  return (STATE_CODES.has(code) && CLIMATE_OF_STATE[code]) || "unknown";
}

/* ------------------------------------------------------------------ *
 * Claims and their region-appropriate replacements
 * ------------------------------------------------------------------ */

// The extreme-heat accent, by climate. `desert` keeps the authored claim
// (that is the one climate where it is honest); every other climate gets
// a phrase that region actually experiences. `neutral` is honest
// everywhere on the mainland and is what unknown regions ship.
const EXTREME_HEAT_PHRASE = {
  hot_humid: "a 97-degree afternoon with 90% humidity",
  humid_continental: "a 95-degree heat wave",
  midatlantic: "a 96-degree heat dome",
  northeast: "a 95-degree heat wave",
  mountain: "a 95-degree afternoon",
  plains: "a 100-degree afternoon",
  pacific_med: "a 100-degree afternoon",
  neutral: "the hottest afternoon of the year",
};

// The extreme-heat replacement's degree token, for claim shapes the phrase
// pattern did not catch ("…tolerates 118-degree heat").
function extremeHeatCore(climate) {
  const phrase = EXTREME_HEAT_PHRASE[climate] || EXTREME_HEAT_PHRASE.neutral;
  return phrase.replace(/^an?\s+/i, "").split(/\s+/)[0];
}

// Word-level swaps for climate nouns with no business in the wrong region.
// CHECK ORDER IS LOAD-BEARING: phrase-level patterns ("desert
// contemporary") run before their bare word.
const CLAIM_RULES = [
  {
    // "a 118-degree afternoon" — 3-digit degree claims are desert scale.
    name: "extreme_heat",
    re: /\ban?\s+1[01][05-9][- ]degree\s+(?:afternoon|day|morning|july|august|streak)\b/gi,
    climates: new Set(["desert"]),
    phrase: (climate) => EXTREME_HEAT_PHRASE[climate] || EXTREME_HEAT_PHRASE.neutral,
  },
  {
    name: "desert_contemporary",
    re: /\bdesert[- ]contemporary\b/gi,
    climates: new Set(["desert"]),
    swap: { default: "modern" },
  },
  {
    name: "high_desert",
    re: /\bhigh[- ]desert\b/gi,
    climates: new Set(["desert"]),
    swap: { default: "sun-baked" },
  },
  {
    name: "desert",
    re: /\bdesert\b/gi,
    climates: new Set(["desert"]),
    swap: { default: "summer" },
  },
  {
    name: "monsoon",
    re: /\bmonsoons?\b/gi,
    climates: new Set(["desert"]),
    swap: { default: "rainstorm" },
  },
  {
    name: "lake_effect",
    re: /\blake[- ]effect\b/gi,
    climates: new Set(["humid_continental", "northeast"]),
    swap: { default: "winter" },
  },
  {
    name: "nor_easter",
    re: /\bnor'?easters?\b/gi,
    climates: new Set(["northeast", "midatlantic"]),
    swap: { default: "winter storm" },
  },
  {
    name: "humidity_qualifier",
    re: /\b(?:\d{2}%\s+humidity|humidity\s+of\s+\d{2}%)\b/gi,
    climates: new Set(["hot_humid", "humid_continental"]),
    swap: { default: "heat" },
  },
];

// Bare degree tokens, last (phrase shapes above take precedence).
const EXTREME_HEAT_TOKEN_RE = /\b1[01][05-9][- ]degree\b/gi;

/* ------------------------------------------------------------------ *
 * The rewrite
 * ------------------------------------------------------------------ */

function applyRulesToText(text, climate) {
  const replacements = [];
  let out = String(text || "");
  for (const rule of CLAIM_RULES) {
    if (rule.climates.has(climate)) continue;
    out = out.replace(rule.re, (matched) => {
      const to = rule.phrase
        ? rule.phrase(climate)
        : (rule.swap && (rule.swap[climate] || rule.swap.default)) || "";
      if (!to || to.toLowerCase() === matched.toLowerCase()) return matched;
      replacements.push({ from: matched, to, claim: rule.name });
      return to;
    });
  }
  // Degree tokens outside the phrase shape. Runs only while unlicensed
  // 3-digit tokens remain, and never fights a phrase already rewritten.
  const desertOk = CLAIM_RULES[0].climates.has(climate);
  if (!desertOk) {
    let guard = 0;
    while (EXTREME_HEAT_TOKEN_RE.test(out) && guard < 4) {
      guard += 1;
      EXTREME_HEAT_TOKEN_RE.lastIndex = 0;
      const core = extremeHeatCore(climate);
      const next = out.replace(EXTREME_HEAT_TOKEN_RE, core);
      if (next === out) break;
      replacements.push({ from: "118-degree-class token", to: core, claim: "extreme_heat_token" });
      out = next;
      EXTREME_HEAT_TOKEN_RE.lastIndex = 0;
    }
  }
  return { text: out, replacements };
}

/** True when the text still carries a claim the climate does not license. */
function carriesUnlicensedClaim(text, climate) {
  const t = String(text || "");
  for (const rule of CLAIM_RULES) {
    if (rule.climates.has(climate)) continue;
    const re = new RegExp(rule.re.source, rule.re.flags);
    if (re.test(t)) return true;
  }
  if (!CLAIM_RULES[0].climates.has(climate)) {
    const re = new RegExp(EXTREME_HEAT_TOKEN_RE.source, EXTREME_HEAT_TOKEN_RE.flags);
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * guardClimateCopyText(html, { state, city }) — the guarded rewrite of one
 * page's climate-sensitive surfaces:
 *   · <title> text, meta description, og and twitter content attributes
 *   · every alt="…" attribute
 *   · <h1>…</h1> blocks anywhere on the page
 *   · <p>/<span> text inside the page's hero regions
 * Returns { html, replacements, climate }.
 */
function guardClimateCopyText(html, { state = "", city = "" } = {}) {
  const climate = climateOf({ state, city });
  const log = [];
  let out = String(html || "");

  // 1. <title> inner text.
  out = out.replace(/<title\b[^>]*>([\s\S]*?)<\/title>/gi, (whole, inner) => {
    const r = applyRulesToText(inner, climate);
    if (!r.replacements.length) return whole;
    for (const x of r.replacements) log.push({ ...x, surface: "title" });
    return whole.replace(inner, r.text);
  });

  // 2. Meta content attributes (description, og:*, twitter:*).
  out = out.replace(/<meta\b[^>]*>/gi, (whole) => {
    if (!/\b(?:description|og:|twitter:)/i.test(whole)) return whole;
    const m = /\bcontent\s*=\s*"([^"]*)"/i.exec(whole);
    if (!m) return whole;
    const r = applyRulesToText(m[1], climate);
    if (!r.replacements.length) return whole;
    for (const x of r.replacements) log.push({ ...x, surface: "meta" });
    return whole.replace(m[1], r.text);
  });

  // 3. alt attributes.
  out = out.replace(/\balt\s*=\s*"([^"]*)"/gi, (whole, inner) => {
    const r = applyRulesToText(inner, climate);
    if (!r.replacements.length) return whole;
    for (const x of r.replacements) log.push({ ...x, surface: "alt" });
    return whole.replace(inner, r.text);
  });

  // 4. <h1> blocks, whole page.
  out = out.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (whole, inner) => {
    const r = applyRulesToText(inner, climate);
    if (!r.replacements.length) return whole;
    for (const x of r.replacements) log.push({ ...x, surface: "h1" });
    return whole.replace(inner, r.text);
  });

  // 5. Body copy: <p>/<h2>/<h3> page-wide, plus <span> text inside the
  //    hero regions. The hero-region scanner's own regex demands a second
  //    quoted attribute after the class name (hero-media's law, unchanged
  //    here), so a bare `<section class="hero">` would slip a lead
  //    paragraph through — and donor hero leads are exactly where authored
  //    climate color lives. The claim vocabulary is narrow enough that
  //    page-wide paragraph coverage is the honest scope.
  out = out.replace(/<(p|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi, (whole, tag, text) => {
    const r = applyRulesToText(text, climate);
    if (!r.replacements.length) return whole;
    for (const x of r.replacements) log.push({ ...x, surface: `body_${tag}` });
    return whole.replace(text, r.text);
  });
  for (const region of heroRegions(out)) {
    const inner = region.inner;
    const next = inner.replace(/<span\b[^>]*>([\s\S]*?)<\/span>/gi, (whole, text) => {
      const r = applyRulesToText(text, climate);
      if (!r.replacements.length) return whole;
      for (const x of r.replacements) log.push({ ...x, surface: "hero_span" });
      return whole.replace(text, r.text);
    });
    if (next !== inner) out = out.split(inner).join(next);
  }

  return { html: out, replacements: log, climate };
}

/**
 * applyClimateCopyGuard({ files, facts })
 *   -> { applied, pages, climate, region, replacements, reason }
 * Mutates `files` in place. Never throws; idempotent (a replacement never
 * reintroduces an unlicensed claim).
 */
function applyClimateCopyGuard({ files = {}, facts = {} } = {}) {
  const report = {
    applied: false,
    pages: 0,
    climate: climateOf(facts),
    region: { state: String(facts.state || "").toUpperCase(), city: String(facts.city || "") },
    replacements: [],
    reason: "",
  };
  try {
    for (const rel of Object.keys(files)) {
      if (!/\.html$/i.test(rel)) continue;
      const html = files[rel].toString("utf8");
      // Cheap pre-filter: no claim vocabulary anywhere on the page, skip.
      if (!/1[01][05-9][- ]degree|desert|monsoon|lake[- ]effect|nor'?easter|humidity/i.test(html)) continue;
      const guarded = guardClimateCopyText(html, facts);
      if (guarded.html !== html) {
        files[rel] = Buffer.from(guarded.html, "utf8");
        report.pages += 1;
      }
      for (const r of guarded.replacements) report.replacements.push({ page: rel, ...r });
    }
    report.applied = report.replacements.length > 0;
    if (!report.applied) report.reason = "no_climate_claims_or_region_licensed";
    return report;
  } catch (e) {
    report.reason = `climate_guard_failed:${String((e && e.message) || e).slice(0, 80)}`;
    return report;
  }
}

/* ------------------------------------------------------------------ *
 * Self-test
 * ------------------------------------------------------------------ */

function runTests() {
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  {
    const html = '<title>Cooling for a 118-degree afternoon</title>'
      + '<h1><span>Cooling</span> <span class="accent-line">engineered for a 118-degree afternoon</span></h1>'
      + '<img alt="Rooftop package cooling unit on a desert contemporary home">';
    const out = guardClimateCopyText(html, { state: "MI", city: "Grand Rapids" });
    check("MI blocks 118-degree (h1)", !/118-degree/i.test(out.html) && out.html.includes("95-degree heat wave"), JSON.stringify(out.replacements));
    check("MI blocks desert alt", !/desert/i.test(out.html) && /modern home/i.test(out.html));
    check("MI title guarded", !/118-degree/i.test(/<title>([\s\S]*?)<\/title>/i.exec(out.html)[1]));
  }
  {
    const html = '<h1>Cooling engineered for a 118-degree afternoon</h1>';
    const az = guardClimateCopyText(html, { state: "AZ", city: "Phoenix" });
    check("Phoenix keeps 118-degree", az.html.includes("118-degree") && az.replacements.length === 0);
    const tx = guardClimateCopyText(html, { state: "TX", city: "Spring" });
    check("Houston TX gets humid phrase", tx.html.includes("97-degree afternoon with 90% humidity"));
    const nj = guardClimateCopyText(html, { state: "NJ", city: "Princeton" });
    check("NJ gets heat dome phrase", nj.html.includes("96-degree heat dome"));
    const sc = guardClimateCopyText(html, { state: "SC", city: "Johns Island" });
    check("SC gets humid phrase", sc.html.includes("97-degree afternoon with 90% humidity"));
    const xx = guardClimateCopyText(html, { state: "", city: "" });
    check("unknown region gets neutral phrase", xx.html.includes("the hottest afternoon of the year"));
  }
  {
    const files = { "index.html": Buffer.from("<h1>Ready for a 118-degree afternoon</h1>") };
    const rep = applyClimateCopyGuard({ files, facts: { state: "MI" } });
    check("files guard applies", rep.applied && !/118-degree/i.test(files["index.html"].toString()));
    const again = applyClimateCopyGuard({ files, facts: { state: "MI" } });
    check("guard is idempotent", again.replacements.length === 0 && again.pages === 0);
  }
  {
    const azFiles = { "index.html": Buffer.from("<h1>Comfort through a lake-effect January</h1>") };
    const az = applyClimateCopyGuard({ files: azFiles, facts: { state: "AZ", city: "Phoenix" } });
    check("lake-effect blocked for Phoenix", az.applied && !/lake-effect/i.test(azFiles["index.html"].toString()));
    const miFiles = { "index.html": Buffer.from("<h1>Comfort through a lake-effect January</h1>") };
    const mi = applyClimateCopyGuard({ files: miFiles, facts: { state: "MI" } });
    check("lake-effect licensed for MI", !mi.applied && /lake-effect/.test(miFiles["index.html"].toString()));
  }

  process.exit(failures === 0 ? 0 : 1);
}

module.exports = {
  climateOf,
  CLAIM_RULES,
  EXTREME_HEAT_PHRASE,
  guardClimateCopyText,
  applyClimateCopyGuard,
  carriesUnlicensedClaim,
};

if (require.main === module && process.argv.includes("--test")) {
  runTests();
}
