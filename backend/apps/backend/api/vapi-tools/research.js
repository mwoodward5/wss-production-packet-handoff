"use strict";

// api/vapi-tools/research.js — RILEY'S EYES.
//
// A local business owner asks three questions on the phone that we can actually
// answer with a search engine, and cannot answer honestly from our own store:
//
//   "where do I come up when someone searches <thing>?"   -> topic "rank"
//   "who's showing up instead of me?"                     -> topic "competitors"
//   "do my details match everywhere?"                     -> topic "listing"
//
// This tool answers those three and refuses everything else. It is deliberately
// NOT a web browser with a phone attached.
//
// ---------------------------------------------------------------------------
// THE HARD LIMIT: THIS TOOL INFORMS. IT NEVER PUBLISHES.
// ---------------------------------------------------------------------------
// Search results are somebody else's text. Two of the worst defects this system
// has shipped came from importing exactly that class of string into a customer's
// page: the donor leak (another company's copy and phone number surviving onto a
// live mirror) and the manufacturer badge (Mastercool's mark served as the
// client's own identity, with every gate green). Both passed review because the
// text LOOKED like content about the business.
//
// So the limit is structural, not advisory:
//   1. There is no write path in this file. It requires no builder, no edit
//      queue, no deploy. test/riley-research.test.js reads this source and
//      fails if one ever appears.
//   2. Nothing but IDENTITY leaves the SERP: a business name, a domain, a
//      position number, the last four digits of a phone. No snippet, no
//      description, no headline, no tagline, no marketing copy — the strings
//      that could be lifted onto a page are never put in the response at all,
//      so there is nothing to lift.
//   3. Every fact is stamped publishable:false and the response carries the
//      reason, so a future caller of this endpoint has to override an explicit
//      refusal rather than assume consent.
// A site change is a separate, confirmed, owner-shaped act: request_site_change.
//
// ---------------------------------------------------------------------------
// SCOPE IS STRUCTURAL TOO
// ---------------------------------------------------------------------------
// The caller cannot hand us a query. Every search this file runs is assembled
// from a resolved client's OWN city and state, so the tool physically cannot be
// steered off that client's market — the free-text part is one short phrase, it
// is scope-checked, and it is always anchored to a city we looked up ourselves.
// No identity, no search.
//
// ---------------------------------------------------------------------------
// LATENCY IS A PRODUCT FEATURE
// ---------------------------------------------------------------------------
// Riley is on a live phone call; dead air is the defect. The shared SERP client
// defaults to 3 attempts with a 20s backoff and a 70s socket timeout — correct
// for a nightly build, ruinous for a conversation. Here the whole call is capped
// (RILEY_RESEARCH_BUDGET_MS, default 5s), one attempt, no backoff, with our own
// AbortSignal on the socket so it actually closes. Anything still outstanding at
// the deadline is dropped and the response says so: a useful partial and an
// honest "I ran out of time" both beat silence, and both beat a guess.
// Every response carries measured timings, and every call records one.
//
// REUSE: the BrightData client is lib/mirror-engine/trust-brightdata.js. This
// file adds no second transport, no second credential, no second retry policy.

const { timingSafeEqual } = require("node:crypto");
const { select, recordEvent } = require("../../lib/store");
const { serp, norm, digits10 } = require("../../lib/mirror-engine/trust-brightdata");
const { resolveCaller } = require("../../lib/site-edit-targets");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

// CALL MEMORY IS OPTIONAL, ON PURPOSE.
//
// lib/riley-call-memory.js belongs to the call-scoped identity work that is in
// flight in another lane; it exists on disk but is not yet in the repo. A hard
// require took this endpoint to FUNCTION_INVOCATION_FAILED on every single
// invocation in production (dpl_CPa4S27p, "Cannot find module") — a tool that is
// only ever reached mid-call, dying at module load, because of a file it does
// not own.
//
// Research does not own caller identity and must not be coupled to it. Without
// the module, a caller who already identified themselves earlier in the call is
// asked once more; with it, they are not. One extra question is a far smaller
// failure than a dead tool, and this starts working the moment that lane lands.
let callMemory = { callIdFromBody: () => null, recallCaller: async () => null };
try { callMemory = { ...callMemory, ...require("../../lib/riley-call-memory") }; } catch { /* not deployed in this build */ }
const callIdFromBody = (body) => { try { return callMemory.callIdFromBody(body); } catch { return null; } };
const recallCaller = (id) => Promise.resolve(callMemory.recallCaller(id)).catch(() => null);

/* ------------------------------------------------------------------ auth */
// The same timing-safe shared-secret check the sibling vapi-tools use. A tool
// provisioned without a secret 401s on every mid-call invocation, which is a
// failure mode this system has already lived through on a real customer call.
function authorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim()).filter(Boolean);
  const got = String(req.headers["x-vapi-secret"] || req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => { const b = Buffer.from(s); return g.length === b.length && timingSafeEqual(g, b); });
}

/* --------------------------------------------------------------- limits */
const TOPICS = Object.freeze(["rank", "competitors", "listing"]);
const DEFAULT_BUDGET_MS = 5000;
const MIN_BUDGET_MS = 1500;
const MAX_BUDGET_MS = 12000;
// The least time in which a SERP call has any chance of landing. Below this the
// search is guaranteed to fail, so spending it is worse than overrunning.
const SEARCH_FLOOR_MS = 2000;
const MAX_PHRASE_CHARS = 80;
const MAX_PHRASE_WORDS = 10;
const MAX_NAME_CHARS = 60;
const MAX_COMPETITORS = 3;
const MAX_LISTING_SOURCES = 5;

const DO_NOT_PUBLISH =
  "Search results are third-party text. Nothing in this response may be written to the client's website, "
  + "quoted on their pages, or copied into their listing. It is for saying out loud on this call only. "
  + "If the caller wants something changed, that is a separate request through request_site_change, in their own words.";

function budgetMs(env = process.env) {
  const raw = Number(env.RILEY_RESEARCH_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BUDGET_MS;
  return Math.min(MAX_BUDGET_MS, Math.max(MIN_BUDGET_MS, Math.round(raw)));
}

/* ---------------------------------------------------------- scope guard */
// A local business owner's own market, and nothing else. These patterns are the
// second line — the first is that every query is anchored to a city WE resolved
// from OUR record, so there is no unanchored search to steer in the first place.
const OPERATORS = /(https?:\/\/|www\.|\S+@\S+\.\S+|\bsite:|\bfiletype:|\binurl:|\bintitle:|\bcache:|\brelated:|\bAND\b|\bOR\b)/;
const PERSON_LOOKUP = /\b(who is|who's|whos|home address|where does|personal (phone|number|email|address)|date of birth|maiden name|arrest|mugshot|warrant|obituary|divorce)\b/i;
const OFF_TOPIC = /\b(weather|forecast|news|headlines|election|president|congress|senator|stock|stocks|shares|crypto|bitcoin|score|scores|nfl|nba|mlb|lyrics|recipe|movie|netflix|porn|nude|escort|dating|hookup|hack|hacked|crack|keygen|torrent|piracy|prescription|symptom|symptoms|diagnose|diagnosis|cancer|lawsuit|sue|attorney general|social security|ssn|passport|credit card|bank account|password|routing number)\b/i;

const SCOPE_SAY =
  "That one's outside what I can look up from here. What I can check is how you come up for a search, "
  + "who else is showing up for it, or whether your listing details match across the web.";

/**
 * scopeCheck(phrase) -> { ok:true, phrase } | { ok:false, reason, say }
 * The phrase is what a CUSTOMER would type into Google to find this business.
 */
function scopeCheck(raw) {
  const phrase = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!phrase) return { ok: false, reason: "search_phrase_missing", say: "I need the words a customer would type in — something like “roof repair near me”. What search did you have in mind?" };
  if (phrase.length > MAX_PHRASE_CHARS) return { ok: false, reason: "search_phrase_too_long", say: "That's longer than anything a customer would actually type. Give me the short version — a few words." };
  if (phrase.split(" ").length > MAX_PHRASE_WORDS) return { ok: false, reason: "search_phrase_too_long", say: "That's longer than anything a customer would actually type. Give me the short version — a few words." };
  if (OPERATORS.test(phrase)) return { ok: false, reason: "search_phrase_not_a_customer_search", say: SCOPE_SAY };
  if (PERSON_LOOKUP.test(phrase)) return { ok: false, reason: "out_of_scope_person_lookup", say: SCOPE_SAY };
  if (OFF_TOPIC.test(phrase)) return { ok: false, reason: "out_of_scope_topic", say: SCOPE_SAY };
  return { ok: true, phrase };
}

/* ------------------------------------------------- identity-only strings */
/**
 * A competitor's own words never leave this function.
 *
 * "Falcon Roof Craft | 25 Years Serving Dallas — GAF Master Elite Certified"
 * becomes "Falcon Roof Craft". The tagline half is exactly the string that ends
 * up baked into a customer's hero if anyone downstream ever forgets what this
 * data is, so it is dropped at the source rather than filtered later.
 *
 * A dash or pipe separator must have whitespace on BOTH sides, so a real
 * hyphenated name ("Smith-Jones Roofing") survives intact. A colon needs only
 * the trailing space, because "Apex Roofing: Free Estimates Today" is the usual
 * shape and no business name carries a colon mid-word.
 */
function safeName(input) {
  return String(input == null ? "" : input)
    .replace(/\s+/g, " ")
    .replace(/\s*:\s+[\s\S]*$/, "")
    .replace(/\s+[|–—·-]\s+[\s\S]*$/, "")
    .replace(/[^A-Za-z0-9&'.,()\/ -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

function hostOf(url) {
  const s = String(url == null ? "" : url).trim();
  if (!s) return "";
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

// Directories are not competitors — "Yelp is ranking above you" is noise, and
// reading a directory back as a rival would be a false claim about the market.
const DIRECTORY_HOSTS = [
  "yelp.com", "bbb.org", "angi.com", "angieslist.com", "homeadvisor.com", "thumbtack.com",
  "houzz.com", "nextdoor.com", "facebook.com", "instagram.com", "yellowpages.com", "manta.com",
  "mapquest.com", "chamberofcommerce.com", "porch.com", "birdeye.com", "expertise.com",
  "google.com", "bing.com", "reddit.com", "wikipedia.org", "indeed.com", "tripadvisor.com",
  "nicelocal.com", "alignable.com", "buildzoom.com",
];
const isDirectory = (host) => DIRECTORY_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * Is this result the caller's own business?
 *
 * Domain agreement is decisive. Name agreement uses the same normalisation as
 * the trust attestation, with one extra guard: containment only counts when the
 * shorter name is substantial. Without it "Ace" would claim every "Ace Hardware
 * Supply Co" in the pack, and a wrong self-match reads out a rank that is not
 * the caller's — the numeric form of the wrong-company defect.
 */
function sameBusiness(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = shorter === x ? y : x;
  return shorter.length >= 5 && longer.includes(shorter);
}

/* --------------------------------------------------------- SERP reading */
// BrightData's parser has shipped the map pack under several names. Read them
// all, and REPORT WHICH ONE ANSWERED — because "you are not in the map results"
// and "this response carried no map results" are different facts, and saying
// the first when we only know the second is an invented claim on a live call.
const LOCAL_PACK_KEYS = ["snack_pack", "local_results", "local_pack", "maps_results", "map_results", "places", "local"];

function readLocalPack(json) {
  for (const key of LOCAL_PACK_KEYS) {
    const v = json && json[key];
    const items = Array.isArray(v) ? v : Array.isArray(v && v.results) ? v.results : null;
    if (items && items.length) {
      return {
        available: true,
        key,
        items: items.map((it, i) => ({
          position: Number.isFinite(Number(it.rank)) ? Number(it.rank) : i + 1,
          name: String(it.name || it.title || ""),
          host: hostOf(it.link || it.url || it.website || ""),
        })),
      };
    }
  }
  return { available: false, key: null, items: [] };
}

function readOrganic(json) {
  const rows = Array.isArray(json && json.organic) ? json.organic : [];
  return rows.map((o, i) => ({
    position: Number.isFinite(Number(o.rank)) ? Number(o.rank) : i + 1,
    // `title` and `description` are read ONLY to match and to pull digits from.
    // Neither is ever copied into a fact or into `say`.
    title: String(o.title || ""),
    description: String(o.description || o.snippet || ""),
    host: hostOf(o.link || o.url || ""),
  }));
}

/** The knowledge panel, accepted only when it provably describes THIS business. */
function readAttestedPanel(json, me) {
  const panel = (json && (json.knowledge || json.knowledge_panel)) || null;
  if (!panel) return null;
  const nameOk = sameBusiness(panel.name, me.business_name);
  const addr = String(panel.address || panel.located_in || "");
  const cityOk = Boolean(me.city && addr.toLowerCase().includes(String(me.city).toLowerCase()));
  const phoneOk = Boolean(me.phone && panel.phone && digits10(panel.phone) === digits10(me.phone));
  if (!nameOk || !(cityOk || phoneOk)) return null;
  return { phone: panel.phone || "", address: addr };
}

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/;

/* ------------------------------------------------------------- analysis */
const quoted = (s) => `“${s}”`;
const marketOf = (me) => [me.city, me.state].filter(Boolean).join(", ") || me.city || "";

/**
 * Where does the caller come up for this search?
 * Two independent answers — the map listings and the regular results — because
 * an owner who is #2 on the map and nowhere in organic is in a completely
 * different position from one who is neither, and one number cannot say both.
 */
function analyzeRank(json, me, phrase) {
  const pack = readLocalPack(json);
  const organic = readOrganic(json);
  const market = marketOf(me);

  const mineInPack = pack.items.find((it) => (me.domain && it.host === me.domain) || sameBusiness(it.name, me.business_name)) || null;
  const mineInOrganic = organic.find((o) => (me.domain && o.host === me.domain) || sameBusiness(o.title, me.business_name)) || null;

  const facts = [
    {
      kind: "map_listing_position",
      available: pack.available,
      position: mineInPack ? mineInPack.position : null,
      found: Boolean(mineInPack),
      matched_by: mineInPack ? (me.domain && mineInPack.host === me.domain ? "website" : "business_name") : null,
      publishable: false,
    },
    {
      kind: "organic_position",
      available: organic.length > 0,
      position: mineInOrganic ? mineInOrganic.position : null,
      found: Boolean(mineInOrganic),
      matched_by: mineInOrganic ? (me.domain && mineInOrganic.host === me.domain ? "website" : "business_name") : null,
      publishable: false,
    },
  ];

  if (!pack.available && !organic.length) {
    return { status: "unavailable", facts, say: `I got a search back for ${quoted(phrase)} but nothing I could read positions out of. I'd rather tell you that than give you a number I'm not sure of.` };
  }

  let say;
  if (mineInPack) {
    say = `For ${quoted(phrase)} you're number ${mineInPack.position} in the map listings in ${market}. That's prime shelf space — the digital version of parking the truck where the whole street can see it.`;
  } else if (pack.available && mineInOrganic) {
    say = `For ${quoted(phrase)} I don't see you in the map listings for ${market}, but you do come up at number ${mineInOrganic.position} in the regular results underneath.`;
  } else if (pack.available) {
    say = `I searched ${quoted(phrase)} for ${market} and didn't find you on the first page, in the map listings or underneath them. Google can only rank what it can verify — right now it isn't finding enough proof to put you up there.`;
  } else if (mineInOrganic) {
    say = `For ${quoted(phrase)} you come up at number ${mineInOrganic.position} in the regular results for ${market}. No map listings came back on that search, so I can't tell you where you sit on the map itself.`;
  } else {
    say = `I searched ${quoted(phrase)} for ${market} and didn't find you in the first page of regular results. No map listings came back on that one, so that part I genuinely can't tell you.`;
  }
  // Never absent, never guessed: the reason we cannot check by website.
  if (!me.domain) facts.push({ kind: "match_basis", value: "business_name_only", note: "we hold no website for this client, so a result can only be matched to them by name", publishable: false });
  return { status: "ok", facts, say };
}

/** Who else is showing up for that search, and where the caller sits among them. */
function analyzeCompetitors(json, me, phrase) {
  const pack = readLocalPack(json);
  const organic = readOrganic(json);
  const market = marketOf(me);
  const source = pack.available ? "map_listings" : "organic_results";

  const rows = pack.available
    ? pack.items.map((it) => ({ position: it.position, name: it.name, host: it.host }))
    : organic.map((o) => ({ position: o.position, name: o.title, host: o.host }));

  const isMine = (r) => (me.domain && r.host === me.domain) || sameBusiness(r.name, me.business_name);
  const mine = rows.find(isMine) || null;

  const competitors = rows
    .filter((r) => !isMine(r) && !isDirectory(r.host) && safeName(r.name))
    .slice(0, MAX_COMPETITORS)
    .map((r) => ({ kind: "competitor", position: r.position, name: safeName(r.name), domain: r.host || null, shown_in: source, publishable: false }));

  const facts = [
    ...competitors,
    { kind: "your_position", shown_in: source, position: mine ? mine.position : null, found: Boolean(mine), publishable: false },
  ];

  if (!competitors.length) {
    return { status: "unavailable", facts, say: `I ran ${quoted(phrase)} for ${market} but couldn't pull out a clean list of who's showing up. I'll take another run at that after the call rather than guess at names.` };
  }

  const names = competitors.map((c) => c.name);
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const where = source === "map_listings" ? "in the map listings" : "in the search results";
  const say = mine
    ? `For ${quoted(phrase)} in ${market}, the ones Google is putting up ${where} are ${listed} — and you're sitting at number ${mine.position}. Worth a look at what they're handing Google that we aren't.`
    : `For ${quoted(phrase)} in ${market}, the ones Google is putting up ${where} are ${listed}, and I don't find you on that first page at all. It's the trade-show walk — not copying their booth, just seeing what they brought that we didn't.`;
  return { status: "ok", facts, say };
}

/**
 * Do the caller's own details agree across the listings we can see?
 *
 * ONLY results that resolve to this business are inspected, and only digits are
 * taken out of them — never the surrounding text. A number that disagrees is
 * reported by its last four, which is enough for an owner to recognise it and
 * the least third-party data that does the job.
 */
function analyzeListing(json, me) {
  const organic = readOrganic(json);
  const ours = digits10(me.phone);
  const facts = [];

  const panel = readAttestedPanel(json, me);
  if (panel && panel.phone) {
    const seen = digits10(panel.phone);
    facts.push({ kind: "listing_check", source: "google_business_profile", field: "phone", matches: Boolean(ours) && seen === ours, observed_ending: seen ? seen.slice(-4) : null, publishable: false });
  }

  for (const row of organic) {
    if (facts.length >= MAX_LISTING_SOURCES) break;
    if (!row.host || !sameBusiness(row.title, me.business_name)) continue;
    const m = PHONE_RE.exec(row.description);
    if (!m) continue;
    const seen = digits10(`${m[1]}${m[2]}${m[3]}`);
    if (!seen) continue;
    if (facts.some((f) => f.source === row.host && f.field === "phone")) continue;
    facts.push({ kind: "listing_check", source: row.host, field: "phone", matches: Boolean(ours) && seen === ours, observed_ending: seen.slice(-4), publishable: false });
  }

  const checks = facts.filter((f) => f.kind === "listing_check");
  if (!ours) {
    return { status: "unavailable", facts, say: "I don't have a phone number on file for you to compare against, so I'd only be guessing at whether your listings agree. Give me the number you want showing and I'll check it properly." };
  }
  if (!checks.length) {
    return { status: "unavailable", facts, say: `I can see listings for ${me.business_name}, but not enough detail in them to compare your number line by line. I'd rather tell you that than tell you they match when I can't see it.` };
  }

  const bad = checks.filter((f) => !f.matches);
  if (!bad.length) {
    const withPanel = checks.some((f) => f.source === "google_business_profile");
    const say = `Your number lines up on ${checks.length === 1 ? "the listing" : `all ${checks.length} of the listings`} I can see${withPanel ? ", including your Google profile" : ""}. That's what you want — the trucks, the invoices and the paperwork all showing the same company.`;
    return { status: "ok", facts, say };
  }
  const first = bad[0];
  const where = first.source === "google_business_profile" ? "Your Google profile" : first.source;
  const say = `${where} is still showing a number ending ${first.observed_ending}, not yours${bad.length > 1 ? `, and ${bad.length - 1} other listing${bad.length > 2 ? "s are" : " is"} out too` : ""}. Google gets suspicious when the same company shows two different numbers, so that one's worth straightening out.`;
  return { status: "ok", facts, say };
}

/* -------------------------------------------------------------- transport */
/**
 * One SERP call, on OUR clock.
 *
 * The shared client's own AbortSignal.timeout(70000) is overridden here by
 * spreading init first and putting our signal after it — one attempt, no
 * backoff, socket closed at the deadline. Same endpoint, same zone, same
 * credential, same parser: no second BrightData client is created.
 */
function cappedFetch(ms) {
  return (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

async function serpWithin(query, ms) {
  const started = Date.now();
  try {
    const json = await serp(query, { attempts: 1, waitMs: 0, fetchImpl: cappedFetch(ms) });
    return { query, json, ok: Boolean(json), ms: Date.now() - started, error: json ? null : "no_result" };
  } catch (error) {
    return { query, json: null, ok: false, ms: Date.now() - started, error: String((error && error.message) || error).slice(0, 120) };
  }
}

/** Resolve to `fallback` at the deadline instead of blocking the call. */
function raceDeadline(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), timeout])
    .finally(() => clearTimeout(timer));
}

async function fullRow(prospectId) {
  const r = await select("ghost_agency_prospects", `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`).catch(() => null);
  const rows = Array.isArray(r) ? r : Array.isArray(r && r.data) ? r.data : [];
  return rows[0] || null;
}

/* ----------------------------------------------------------------- shape */
function envelope(extra) {
  return {
    ok: true,
    use: "spoken_only",
    do_not_publish: DO_NOT_PUBLISH,
    ...extra,
  };
}

/* --------------------------------------------------------------- handler */
async function research(body, env = process.env) {
  const startedAt = Date.now();
  const budget = budgetMs(env);
  const call = body?.message?.toolCalls?.[0];
  let args = call?.function?.arguments ?? body?.arguments ?? body ?? {};
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }

  const topic = String(args.topic || args.question || "").trim().toLowerCase();
  if (!TOPICS.includes(topic)) {
    return envelope({
      topic: topic || null, status: "refused", reason: "topic_not_supported",
      say: SCOPE_SAY, facts: [], sources: [],
      timing: { elapsed_ms: Date.now() - startedAt, budget_ms: budget, timed_out: false, partial: false },
    });
  }

  // "listing" searches the business's own name; the other two search a phrase.
  let phrase = "";
  if (topic !== "listing") {
    const scoped = scopeCheck(args.search_phrase || args.phrase || args.search || "");
    if (!scoped.ok) {
      return envelope({
        topic, status: "refused", reason: scoped.reason, say: scoped.say, facts: [], sources: [],
        timing: { elapsed_ms: Date.now() - startedAt, budget_ms: budget, timed_out: false, partial: false },
      });
    }
    phrase = scoped.phrase;
  }

  // ---- identity. No client, no search: every query is anchored to a city we
  // resolved ourselves, which is what keeps this from being a web browser.
  const identity = {
    reference: args.client_ref || args.client_id || args.reference || args.code || "",
    phone: args.phone || args.caller_phone || args.from || "",
    businessName: args.business_name || args.name || "",
    prospectId: args.prospect_id || args.prospectId || "",
  };
  const callId = callIdFromBody(body);
  if (!identity.reference && !identity.phone && !identity.businessName && !identity.prospectId && callId) {
    const remembered = await recallCaller(callId).catch(() => null);
    if (remembered && remembered.prospect_id) identity.prospectId = remembered.prospect_id;
  }
  const who = await resolveCaller(identity).catch(() => ({ status: "not_found", say: "I couldn't pull the record up just now." }));
  const identity_ms = Date.now() - startedAt;

  if (who.status === "ambiguous") {
    return envelope({
      topic, status: "refused", reason: "caller_ambiguous", candidates: who.candidates, say: who.say, facts: [], sources: [],
      timing: { identity_ms, elapsed_ms: Date.now() - startedAt, budget_ms: budget, timed_out: false, partial: false },
    });
  }
  if (who.status !== "ok") {
    return envelope({
      topic, status: "unavailable", reason: "caller_not_resolved",
      say: "I can only look this up against your own record, and I haven't got you pulled up yet. What's the Client ID on your email — it starts with W S S?",
      facts: [], sources: [],
      timing: { identity_ms, elapsed_ms: Date.now() - startedAt, budget_ms: budget, timed_out: false, partial: false },
    });
  }

  const market = [who.city, who.state].filter(Boolean).join(" ");
  const query = topic === "listing"
    ? [`"${who.business_name}"`, market].filter(Boolean).join(" ").trim()
    : [phrase, market].filter(Boolean).join(" ").trim();

  // ---- search + the client's own website, in parallel, both on the clock.
  //
  // MEASURED IN PRODUCTION (2026-08-11): resolving a real Client ID costs
  // 700-890ms, so the search normally gets the rest of the budget. A caller we
  // cannot resolve costs ~3.4s — a full-table collision scan — but that path
  // returns above without searching at all, so it never eats into this.
  // The floor is the guard for the case in between: handing the search 600ms is
  // handing it a guaranteed failure, and a slight overrun that produces a real
  // answer beats an on-time non-answer.
  const remaining = Math.max(SEARCH_FLOOR_MS, budget - identity_ms);
  const timedOutSearch = { query, json: null, ok: false, ms: remaining, error: "budget_exhausted", timed_out: true };
  const [search, row] = await Promise.all([
    raceDeadline(serpWithin(query, remaining), remaining, timedOutSearch),
    raceDeadline(fullRow(who.prospect_id), remaining, null),
  ]);

  const me = {
    business_name: who.business_name || "",
    city: who.city || "",
    state: who.state || "",
    phone: who.phone || (row && row.phone) || "",
    domain: hostOf((row && (row.current_website || row.website)) || ""),
  };

  const timing = {
    identity_ms,
    search_ms: search.ms,
    elapsed_ms: Date.now() - startedAt,
    budget_ms: budget,
    timed_out: Boolean(search.timed_out) || /timed out|aborted|TimeoutError/i.test(String(search.error || "")),
    partial: false,
  };
  const sources = [{ engine: "google via brightdata serp", query, observed_at: new Date().toISOString(), reached: search.ok }];

  if (!search.ok) {
    timing.partial = true;
    const say = timing.timed_out
      ? "The search didn't come back in time and I'm not going to guess at a number while you're on the phone. Let me run it right after we hang up and get you the real answer."
      : "I couldn't get an answer back from the search just now. I'd rather tell you that than make one up — let me chase it down and come back to you.";
    const out = envelope({
      topic, status: "unavailable", reason: timing.timed_out ? "search_timed_out" : "search_unavailable",
      say,
      // The search WAS attempted. Reporting the query on the success path only
      // would read, in a log or a probe, as though nothing had been tried.
      searched: query,
      facts: [], sources,
      client: { business_name: me.business_name, client_id: who.client_id, city: me.city, state: me.state },
      timing,
    });
    await recordEvent("riley.research", { topic, status: out.status, reason: out.reason, prospect_id: who.prospect_id, ...timing }).catch(() => {});
    return out;
  }

  const analysis = topic === "rank" ? analyzeRank(search.json, me, phrase)
    : topic === "competitors" ? analyzeCompetitors(search.json, me, phrase)
      : analyzeListing(search.json, me);

  // The client's own website never landed inside the budget — a name-only match
  // is weaker, and the response says so rather than quietly downgrading.
  if (!row) {
    timing.partial = true;
    analysis.facts.push({ kind: "match_basis", value: "record_unavailable", note: "the client's own website did not load inside the budget, so results were matched by name only", publishable: false });
  }
  timing.elapsed_ms = Date.now() - startedAt;

  const out = envelope({
    topic,
    status: analysis.status,
    say: analysis.say,
    searched: query,
    client: { business_name: me.business_name, client_id: who.client_id, city: me.city, state: me.state },
    facts: analysis.facts,
    sources,
    timing,
  });
  await recordEvent("riley.research", { topic, status: out.status, prospect_id: who.prospect_id, facts: analysis.facts.length, ...timing }).catch(() => {});
  return out;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
  try {
    const body = await readJson(req).catch(() => ({}));
    const result = await research(body, process.env);
    const call = body?.message?.toolCalls?.[0];
    if (call?.id) return sendJson(res, 200, { results: [{ toolCallId: call.id, result: JSON.stringify(result) }] });
    return sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
};

// Exposed for tests. The analysis functions are pure over a SERP payload, which
// is how the "no third-party copy ever reaches the response" property is pinned
// against a fixture stuffed with exactly the marketing text that must not leak.
module.exports.research = research;
module.exports.TOPICS = TOPICS;
module.exports.DO_NOT_PUBLISH = DO_NOT_PUBLISH;
module.exports.budgetMs = budgetMs;
module.exports.scopeCheck = scopeCheck;
module.exports.safeName = safeName;
module.exports.hostOf = hostOf;
module.exports.sameBusiness = sameBusiness;
module.exports.readLocalPack = readLocalPack;
module.exports.readOrganic = readOrganic;
module.exports.analyzeRank = analyzeRank;
module.exports.analyzeCompetitors = analyzeCompetitors;
module.exports.analyzeListing = analyzeListing;
module.exports.MAX_COMPETITORS = MAX_COMPETITORS;
module.exports.SEARCH_FLOOR_MS = SEARCH_FLOOR_MS;
