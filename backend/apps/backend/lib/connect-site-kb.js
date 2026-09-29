"use strict";

/**
 * lib/connect-site-kb.js — what a mirror is allowed to say about its own client.
 *
 * ===========================================================================
 * THE LAW THIS FILE EXISTS TO ENFORCE
 * ===========================================================================
 * A bot speaking AS a business to that business's customer is the fabrication
 * risk with a megaphone, and this system has a documented history of exactly
 * that: an injection model that invented services and reviews, and a live
 * mirror that shipped fake "A. Client" testimonials to a real company. So the
 * rule is not "be careful", it is structural:
 *
 *       THE ASSISTANT MAY ONLY SAY WHAT THE SITE ALREADY PUBLISHES.
 *
 * This module is where that becomes checkable. Every entry it produces carries
 * the SOURCE it came from. Anything that cannot name a source is not in the
 * knowledge base at all — it is in `absent`, by name, so the answering layer
 * can say "the site doesn't say, let me get that answered for you" instead of
 * guessing. A handoff converts better than a guess anyway.
 *
 * There is exactly one source that may exceed the published site, and it is
 * marked as such: `owner_custom_qa`, because a human wrote it about his own
 * business. See lib/connect-site-settings.js.
 *
 * ===========================================================================
 * WHERE THE KNOWLEDGE COMES FROM, AND WHY IT IS NOT A BUILD HOOK
 * ===========================================================================
 * Nothing here hooks mirror-lane-build.js or content-inject.js. Two reasons,
 * and the second is the important one:
 *
 *   1. Those files are under active edit elsewhere; two writers collide.
 *   2. Deriving from what is ALREADY STORED and ALREADY DEPLOYED means every
 *      site built before today lights up retroactively. A build hook would
 *      only ever cover sites built after it landed — which, on a fleet of 221
 *      deployed mirrors, is the difference between a feature and a plan.
 *
 * Two sources, merged section by section, never blended within a section:
 *
 *   site_island      The deployed page's own `<script id="wss-content">` data
 *                    island (window.__WSS_CONTENT__). This is LITERALLY what
 *                    the site publishes, so it leads. It is the only place
 *                    services / FAQs / areas / about exist at all — measured
 *                    2026-08-11 across 1,333 prospect rows, ZERO stored
 *                    contracts carry any of them, while the deployed page for
 *                    the same business carries twelve services.
 *
 *   stored_contract  record.build_ready.mirror_request on ghost_agency_prospects
 *                    — the miner's Google-observed, provenanced facts, plus the
 *                    hours and reviews it paid for. Present on 141 of 141 rows
 *                    that have a contract. This is the durable half: it answers
 *                    when the deployed page cannot be reached, and it is where
 *                    industry, coordinates, county and the Google profile link
 *                    live, none of which the island carries.
 *
 *   prospect_row     Last-resort NAP from the row's own columns.
 *
 * "First non-empty wins, section by section" is the same rule
 * mirror-lane-build.js uses for content merging, and for the same reason: five
 * review quotes half from one observation and half from another is a corpus
 * nobody observed.
 *
 * ===========================================================================
 * TENANT ISOLATION IS CHECKED THREE TIMES, DELIBERATELY
 * ===========================================================================
 *   1. resolveSite() matches on an INDEXED, EXACT site_slug and then re-derives
 *      the slug from preview_url in JavaScript before returning the row. More
 *      than one exact match is a refusal, never a coin flip.
 *   2. fetchSiteIsland() rejects an island whose own facts.site_url resolves to
 *      a different slug — that is the Vercel-alias-lag failure this codebase
 *      has already been burned by, where a host briefly serves another
 *      business's build.
 *   3. The memo cache is keyed by slug AND the currently resolved prospect id.
 *      A slug reassigned to another prospect can never inherit the former
 *      tenant's warm entry.
 *
 * The network reach is bounded by construction: the only URL this module ever
 * fetches is `https://<SLUG_RE-validated slug>.wss-ai.com/`.
 */

const { SLUG_RE, slugFromHost } = require("./mirror-lead");
const { filterPlaceNames, STATE_CODES } = require("./mirror-engine/place-names");
const { readSiteSettings } = require("./connect-site-settings");
const { hasUnresolvedToken } = require("./connect-site-settings");
const { select: defaultSelect } = require("./store");

const PROSPECTS_TABLE = "ghost_agency_prospects";
const MIRROR_HOST_SUFFIX = ".wss-ai.com";

const SOURCES = Object.freeze({
  island: "site_island",
  visiblePage: "site_visible_html",
  contract: "stored_contract",
  row: "prospect_row",
  ownerQa: "owner_custom_qa",
  ownerSetting: "owner_setting",
  reviewCount: "counted_from_reviews",
});

const MAX = Object.freeze({
  services: 24,
  faqs: 24,
  hours: 14,
  areas: 24,
  nearbyTowns: 24,
  reviewQuotes: 8,
  aboutChars: 2000,
  answerChars: 1500,
  htmlBytes: 3 * 1024 * 1024,
  groundingChars: 14000,
  cacheEntries: 200,
});

const ISLAND_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

/** The topics a visitor actually asks about. Every one is either known or named. */
const TOPICS = Object.freeze([
  "business_name", "phone", "email", "address", "hours",
  "services", "faqs", "areas", "nearby_towns", "about", "reviews",
  "booking_url",
]);

const trim = (v) => String(v == null ? "" : v).trim();
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * REFUSES an over-long value rather than truncating it. The older idiom in
 * lib/connect-chat.js is `.slice(0, 80)` and then SLUG_RE — which quietly turns
 * a 200-character string into a VALID 80-character slug belonging to somebody
 * else. Truncation is a silent identity change, and identity is the one thing
 * this module is not allowed to guess at.
 */
function normalizeSlug(value) {
  const slug = trim(value).toLowerCase();
  return slug.length <= 80 && SLUG_RE.test(slug) ? slug : "";
}

/**
 * Text a customer may be shown. Refuses unresolved template syntax — a service
 * called "{{SERVICE_1}}" is not a service, and a mirror that renders its own
 * tokens has already failed token_scan everywhere else in this codebase.
 */
function speakable(value, maxChars = 400) {
  const raw = trim(value).replace(/\s+/g, " ").slice(0, maxChars);
  if (!raw) return { text: "", reason: "empty" };
  if (hasUnresolvedToken(raw)) return { text: "", reason: "unresolved_template_token" };
  return { text: raw, reason: "" };
}

// ---------------------------------------------------------------------------
// THE DEPLOYED PAGE'S OWN DATA ISLAND
// ---------------------------------------------------------------------------

const ISLAND_RE = /<script id="wss-content" type="application\/json">([\s\S]*?)<\/script>/i;

/**
 * parseContentIsland(html) -> { ok, island } | { ok: false, reason }
 *
 * The island is written by content-inject.js as `wss-content-v1`. A future v2
 * is refused rather than half-read: a shape we do not understand is not a shape
 * we may quote from.
 */
function parseContentIsland(html) {
  const match = ISLAND_RE.exec(String(html || "").slice(0, MAX.htmlBytes));
  if (!match) return { ok: false, reason: "no_content_island_on_page" };
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { ok: false, reason: "content_island_not_json" };
  }
  if (!isObject(parsed)) return { ok: false, reason: "content_island_not_an_object" };
  const version = trim(parsed.version);
  if (version && version !== "wss-content-v1") return { ok: false, reason: `content_island_version_unsupported:${version.slice(0, 40)}` };
  return { ok: true, island: parsed };
}

/**
 * Facts the rendered page publishes outside `wss-content`.
 *
 * Local-SEO sections are added to the generated HTML after the content island
 * is written. That means a visitor can read a nearby town which the assistant
 * cannot see if it only parses the island. Keep those facts in their own
 * section: a town printed under "Driving directions from nearby towns" is not
 * automatically a promised service area.
 */
const VISIBLE_PAGE_PROOF = Symbol("wss_visible_page_facts");
const NEAR_LIST_RE = /<ul[^>]*class=["'][^"']*\bwss-c__nearlist\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/gi;
const NEARBY_ROW_RE = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const NEARBY_TOWN_RE = /<span[^>]*class=["'][^"']*\bwss-c__neartown\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class=["'][^"']*\bwss-c__neardist\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;
const MAP_HREF_RE = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/i;
const TOWN_LABEL_RE = /^([\p{Lu}][\p{L}\p{M}.'’\-]*(?: (?:(?:and|de|del|des|du|la|las|le|los|of|or|the)|d'[\p{Lu}][\p{L}\p{M}.'’\-]*|[\p{Lu}][\p{L}\p{M}.'’\-]*)){0,4}), ([A-Z]{2})$/u;
const TOWN_INSTRUCTION_RE = /\b(?:all|assistant|call|command|developer|disregard|everyone|follow|forget|ignore|instruction|message|nearby|obey|output|password|previous|prior|prompt|proudly|respond|reveal|rule|rules|say|secret|serve|serves|service|serving|system|tell|token|user|write)\b/i;
const DISTANCE_RE = /^(\d{1,3}(?:\.\d{1,2})?) (mi|km)$/i;

const VOID_HTML_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const NON_VISIBLE_HTML_TAGS = new Set(["script", "style", "template", "noscript"]);

function openingTagIsHidden(token, tag) {
  if (NON_VISIBLE_HTML_TAGS.has(tag)) return true;
  if (/\s(?:hidden)(?:\s|=|\/?>)/i.test(token)) return true;
  if (/\saria-hidden\s*=\s*(?:["']true["']|true)(?=\s|\/?>)/i.test(token)) return true;
  const style = /\sstyle\s*=\s*(?:(["'])(.*?)\1|([^\s"'=<>`]+))/is.exec(token);
  const styleValue = style && (style[2] || style[3] || "");
  return Boolean(styleValue && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(styleValue));
}

/** Keep only markup a visitor can actually read; comments and hidden/template
 * copies are data-source noise, not published facts. */
function visibleHtmlOnly(value) {
  const source = String(value || "").slice(0, MAX.htmlBytes);
  const tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g) || [];
  const stack = [];
  const output = [];
  for (const token of tokens) {
    if (/^<!--|^<![^/]/.test(token)) continue;
    const close = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)[^>]*>/.exec(token);
    if (close) {
      const tag = close[1].toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index].tag !== tag) index -= 1;
      if (index < 0) continue;
      const frame = stack[index];
      stack.length = index;
      if (!frame.hidden) output.push(token);
      continue;
    }
    const open = /^<\s*([A-Za-z][A-Za-z0-9:-]*)[^>]*>/.exec(token);
    if (open) {
      const tag = open[1].toLowerCase();
      const inherited = stack.length ? stack[stack.length - 1].hidden : false;
      const hidden = inherited || openingTagIsHidden(token, tag);
      if (!hidden) output.push(token);
      if (!VOID_HTML_TAGS.has(tag) && !/\/\s*>$/.test(token)) stack.push({ tag, hidden });
      continue;
    }
    if (!stack.length || !stack[stack.length - 1].hidden) output.push(token);
  }
  return output.join("");
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, token) => {
      const number = String(token).toLowerCase().startsWith("x")
        ? Number.parseInt(String(token).slice(1), 16)
        : Number.parseInt(token, 10);
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
        && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : whole;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (whole, name) => ({
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    })[String(name).toLowerCase()] || whole)
    .replace(/\s+/g, " ")
    .trim();
}

function strictNearbyTown(value) {
  const raw = String(value || "");
  if (!raw || raw.length > 100 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return "";
  const town = decodeHtmlText(raw);
  const match = TOWN_LABEL_RE.exec(town);
  if (!match || !STATE_CODES.has(match[2]) || TOWN_INSTRUCTION_RE.test(town)) return "";
  return town;
}

function strictNearbyDistance(value) {
  const raw = String(value || "");
  if (!raw || raw.length > 24 || /[<>\u0000-\u001f\u007f]/.test(raw)) return "";
  const distance = decodeHtmlText(raw);
  const match = DISTANCE_RE.exec(distance);
  const amount = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 500) return "";
  return `${match[1]} ${match[2].toLowerCase()}`;
}

/** The visible label must be the origin of our generated Google-directions row. */
function directionsRowProvesTown(rowHtml, town) {
  const hrefMatch = MAP_HREF_RE.exec(String(rowHtml || ""));
  if (!hrefMatch) return false;
  let url;
  try {
    url = new URL(decodeHtmlText(hrefMatch[2]));
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.hostname === "www.google.com"
    && url.pathname === "/maps/dir/"
    && url.searchParams.get("api") === "1"
    && trim(url.searchParams.get("origin")) === town
    && Boolean(trim(url.searchParams.get("destination")));
}

function visiblePageFacts(html) {
  const source = visibleHtmlOnly(html);
  const nearbyTowns = [];
  const seen = new Set();
  NEAR_LIST_RE.lastIndex = 0;
  for (let list = NEAR_LIST_RE.exec(source); list && nearbyTowns.length < MAX.nearbyTowns; list = NEAR_LIST_RE.exec(source)) {
    NEARBY_ROW_RE.lastIndex = 0;
    for (let row = NEARBY_ROW_RE.exec(list[1]); row && nearbyTowns.length < MAX.nearbyTowns; row = NEARBY_ROW_RE.exec(list[1])) {
      const pair = NEARBY_TOWN_RE.exec(row[1]);
      if (!pair) continue;
      const name = strictNearbyTown(pair[1]);
      const distance = strictNearbyDistance(pair[2]);
      const key = name.toLowerCase();
      if (!name || !distance || seen.has(key) || !directionsRowProvesTown(row[1], name)) continue;
      seen.add(key);
      nearbyTowns.push({ name, distance });
    }
  }
  const facts = { nearbyTowns };
  Object.defineProperty(facts, VISIBLE_PAGE_PROOF, { value: true });
  return facts;
}

/**
 * fetchSiteIsland(slug) -> { ok, island, url } | { ok: false, reason, url }
 *
 * Reads the live mirror's home page and lifts its island. The slug is
 * SLUG_RE-validated before it can reach a URL, so the reachable surface is
 * exactly one host per call and always ours.
 */
async function fetchSiteIsland(siteSlug, { fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const slug = normalizeSlug(siteSlug);
  const url = `https://${slug}${MIRROR_HOST_SUFFIX}/`;
  if (!slug) return { ok: false, reason: "invalid_site_slug", url: "" };
  if (typeof fetchImpl !== "function") return { ok: false, reason: "no_fetch_available", url };

  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      headers: { accept: "text/html", "user-agent": "WSSConnectKB/1.0 (+https://wss-ai.com)" },
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (error) {
    return { ok: false, reason: `site_unreachable:${String(error && error.name || "error").slice(0, 40)}`, url };
  }
  if (!response || response.ok !== true) {
    return { ok: false, reason: `site_status_${Number(response && response.status) || 0}`, url };
  }

  let html;
  try {
    html = await response.text();
  } catch {
    return { ok: false, reason: "site_body_unreadable", url };
  }

  const parsed = parseContentIsland(html);
  if (!parsed.ok) return { ...parsed, url };

  // THE ALIAS-LAG GUARD. A mirror host can briefly serve another business's
  // build; that is not hypothetical here, it is written down in the project's
  // own history. The island names the site it was built for, so make it prove
  // it is this one before a single word of it is quotable.
  const islandSlug = slugFromHost(trim(parsed.island.facts && parsed.island.facts.site_url));
  if (!islandSlug) {
    return { ok: false, reason: "content_island_site_unbound", url };
  }
  if (islandSlug !== slug) {
    return { ok: false, reason: `content_island_belongs_to:${islandSlug.slice(0, 80)}`, url };
  }
  return {
    ok: true,
    island: { ...parsed.island, _visiblePageFacts: visiblePageFacts(html) },
    url,
  };
}

// ---------------------------------------------------------------------------
// SLUG -> BUSINESS
// ---------------------------------------------------------------------------

function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  if (result && result.ok === true && Array.isArray(result.data)) return { ok: true, rows: result.data };
  if (result && result.mode === "live_select" && Array.isArray(result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [] };
}

const PROSPECT_COLUMNS = "prospect_id,business_name,phone,email,status,preview_url,record";

/**
 * resolveSite(slug) -> { ok, slug, prospectId, businessName, previewUrl, record, source }
 *
 * WHAT CHANGED, AND WHAT THE MEASUREMENT ACTUALLY SAID.
 *
 * The existing knownSite() in lib/connect-chat.js resolves a slug with
 * `preview_url=ilike.*<slug>*&limit=25` and then filters for an exact
 * slugFromHost() match in JavaScript. Two things are wrong with that, and it is
 * worth being precise about which one is biting today, because they are not the
 * same severity:
 *
 *   · MEASURED, biting now: it is an unindexed sequential scan. `explain
 *     analyze` on production, 2026-08-11 — Seq Scan, "Rows Removed by Filter:
 *     1332", 0.797ms, on a public unauthenticated endpoint, growing linearly
 *     with the funnel. The indexed equality is a Bitmap Index Scan at 0.039ms
 *     and stays flat.
 *
 *   · LATENT, not biting now: the LIMIT is applied by Postgres BEFORE the exact
 *     match happens in Node, so a slug appearing as a substring of twenty-five
 *     other preview URLs would be pushed out of its own result window and
 *     resolve to "site not available". I checked rather than assumed: the worst
 *     substring fan-out across every live slug is 1, so ZERO slugs can hit this
 *     today. It is a trap laid for a future fleet with shorter, more-shared
 *     slugs (the shortest live slug is already `salon-icon`), not a bug anyone
 *     is currently experiencing.
 *
 * sql/connect_site_kb.sql adds `ghost_agency_prospects.site_slug`, a GENERATED
 * column parsed from preview_url by public.wss_mirror_slug() — the same parse
 * slugFromHost() performs, verified equal across all 221 rows with a preview
 * URL plus seventeen adversarial cases — with a partial index on it. The lookup
 * becomes an exact indexed equality, which fixes the first and forecloses the
 * second.
 *
 * The legacy ilike path is still here as a fallback, because a deploy can reach
 * production before a migration does and a chat bubble that dies on that
 * ordering is a bubble nobody trusts. It is used only when the column is
 * missing or matched nothing.
 *
 * knownSite() is deliberately NOT modified. It answers a different question
 * (may this slug be used as a routing key at all) and it is on the hot path of
 * three live endpoints.
 */
async function resolveSite(siteSlug, { select = defaultSelect } = {}) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return { ok: false, slug: "", reason: "invalid_site_slug", source: "" };

  const indexed = await Promise.resolve()
    .then(() => select(PROSPECTS_TABLE, `select=${PROSPECT_COLUMNS}&site_slug=eq.${encodeURIComponent(slug)}&limit=5`))
    .catch(() => null);
  const byColumn = readRows(indexed);
  if (byColumn.ok) {
    const decided = decideSite(slug, byColumn.rows, "site_slug_index");
    if (decided) return decided;
  }

  const scanned = await Promise.resolve()
    .then(() => select(PROSPECTS_TABLE, `select=${PROSPECT_COLUMNS}&preview_url=ilike.*${encodeURIComponent(slug)}*&limit=25`))
    .catch(() => null);
  const byScan = readRows(scanned);
  if (!byColumn.ok && !byScan.ok) return { ok: false, slug, reason: "site_lookup_unavailable", source: "" };
  const decided = decideSite(slug, byScan.rows, "preview_url_scan");
  if (decided) return decided;

  return { ok: false, slug, reason: "site_not_found", source: byColumn.ok ? "site_slug_index" : "preview_url_scan" };
}

/** Exactly one row whose preview_url really is this slug, or nothing. */
function decideSite(slug, rows, source) {
  const exact = (Array.isArray(rows) ? rows : []).filter((row) => {
    const status = trim(row && row.status).toLowerCase();
    return status !== "archived_legacy" && slugFromHost(trim(row && row.preview_url)) === slug;
  });
  if (!exact.length) return null;
  // Ambiguous ownership is a hard refusal. Picking one would be picking whose
  // customer hears whose answer.
  if (exact.length > 1) return { ok: false, slug, reason: "site_ambiguous", source };
  const row = exact[0];
  return {
    ok: true,
    slug,
    source,
    prospectId: trim(row.prospect_id),
    businessName: trim(row.business_name),
    phone: trim(row.phone),
    email: trim(row.email),
    previewUrl: trim(row.preview_url),
    record: isObject(row.record) ? row.record : {},
  };
}

// ---------------------------------------------------------------------------
// SHAPING EACH SECTION, WITH ITS PROVENANCE
// ---------------------------------------------------------------------------

function contractOf(record) {
  const buildReady = isObject(record) && isObject(record.build_ready) ? record.build_ready : {};
  return isObject(buildReady.mirror_request) ? buildReady.mirror_request : {};
}

function servicesFrom(list, source, refusals) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (out.length >= MAX.services) break;
    const rawName = typeof entry === "string" ? entry : (entry && entry.name);
    const name = speakable(rawName, 120);
    if (!name.text) {
      if (trim(rawName)) refusals.push({ field: "services", value: trim(rawName).slice(0, 80), reason: name.reason });
      continue;
    }
    const description = speakable(entry && entry.description, 400);
    out.push({ name: name.text, ...(description.text ? { description: description.text } : {}), source });
  }
  return out;
}

function faqsFrom(list, source, refusals) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (out.length >= MAX.faqs) break;
    if (!isObject(entry)) continue;
    const question = speakable(entry.q || entry.question, 300);
    const answer = speakable(entry.a || entry.answer, MAX.answerChars);
    if (!question.text || !answer.text) {
      refusals.push({ field: "faqs", value: trim(entry.q || entry.question).slice(0, 80), reason: question.reason || answer.reason || "empty" });
      continue;
    }
    out.push({ question: question.text, answer: answer.text, source });
  }
  return out;
}

const DAY_RE = /^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*[:–-]\s*(.+)$/i;

/**
 * Hours arrive in two shapes and both are real: the stored contract writes
 * `{day, text}`, the deployed island writes `"Monday: 7:00 AM – 4:00 PM"`.
 * Normalising a published string into its own two halves is reading, not
 * inventing — no hour is ever synthesised, and a line that does not name a day
 * is kept verbatim rather than assigned one.
 */
function hoursFrom(list, source, refusals) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (out.length >= MAX.hours) break;
    if (isObject(entry)) {
      const day = speakable(entry.day, 20);
      const text = speakable(entry.text || entry.hours, 80);
      if (!text.text) {
        if (trim(entry.text)) refusals.push({ field: "hours", value: trim(entry.text).slice(0, 40), reason: text.reason });
        continue;
      }
      out.push({ day: day.text.toLowerCase(), text: text.text, source });
      continue;
    }
    const line = speakable(entry, 120);
    if (!line.text) continue;
    const match = DAY_RE.exec(line.text);
    if (match) out.push({ day: match[1].toLowerCase(), text: trim(match[2]), source });
    else out.push({ day: "", text: line.text, source });
  }
  return out;
}

/**
 * Service-area towns, held to the shared place-name predicate. This is the
 * gate that keeps the assistant from telling a customer the business serves
 * "9, LA" — the exact string a live mirror printed to a real Louisiana company
 * on 2026-08-11. See lib/mirror-engine/place-names.js.
 */
function areasFrom(list, source, refusals) {
  const raw = (Array.isArray(list) ? list : []).map((a) => (isObject(a) ? trim(a.name) : trim(a))).filter(Boolean);
  const { kept, dropped } = filterPlaceNames(raw);
  for (const casualty of dropped) refusals.push({ field: "areas", value: casualty.value.slice(0, 60), reason: `implausible_place_name:${casualty.reason}` });
  return kept.slice(0, MAX.areas).map((name) => ({ name, source }));
}

function nearbyTownsFrom(list, source, refusals) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (out.length >= MAX.nearbyTowns) break;
    const name = isObject(entry) ? strictNearbyTown(entry.name) : "";
    const distance = isObject(entry) ? strictNearbyDistance(entry.distance) : "";
    if (!name || !distance) {
      refusals.push({ field: "nearby_towns", value: trim(entry && entry.name).slice(0, 60), reason: "invalid_visible_town_schema" });
      continue;
    }
    const places = filterPlaceNames([name]);
    if (!places.kept.length) {
      const reason = places.dropped[0] && places.dropped[0].reason;
      refusals.push({ field: "nearby_towns", value: name.slice(0, 60), reason: `implausible_place_name:${reason || "unknown"}` });
      continue;
    }
    out.push({ name: places.kept[0], distance, source });
  }
  return out;
}

function reviewQuotesFrom(list, source) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (out.length >= MAX.reviewQuotes) break;
    if (!isObject(entry)) continue;
    // A review is a quotation, not our prose: it is carried verbatim and it is
    // never rewritten. Anything without text is not a review.
    const text = trim(entry.text).slice(0, 1200);
    if (!text) continue;
    const rating = Number(entry.rating);
    out.push({
      text,
      ...(trim(entry.author) ? { author: trim(entry.author).slice(0, 80) } : {}),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(trim(entry.publishedAt || entry.published_at) ? { publishedAt: trim(entry.publishedAt || entry.published_at).slice(0, 40) } : {}),
      source,
    });
  }
  return out;
}

/**
 * WHAT REVIEWERS KEEP MENTIONING — counted, never characterised.
 *
 * A theme is not a claim the business makes and it must never be spoken as
 * one. It is a count of a fixed vocabulary against review text the site already
 * publishes, and it only becomes a theme at two or more DISTINCT reviews, so a
 * single enthusiastic customer cannot become "customers say we are fast".
 * Every theme carries its mention count so the answering layer can attribute
 * it: "several reviewers mention X", never "we are X".
 */
const THEME_TERMS = Object.freeze([
  ["on time", /\bon[\s-]?time\b|\bpunctual\b/i],
  ["fast response", /\bfast\b|\bquick(ly)?\b|\bprompt(ly)?\b|\bright away\b/i],
  ["professional", /\bprofessional(ism)?\b/i],
  ["friendly", /\bfriendly\b|\bcourteous\b|\bpolite\b|\bpleasant\b/i],
  ["fair pricing", /\b(fair|reasonable|honest|competitive)\s+(price|pricing|prices|cost|quote|estimate)\b|\baffordable\b/i],
  ["explained the work", /\bexplain(ed|s|ing)?\b|\bwalked (me|us) through\b|\banswered (all )?(my|our) questions\b/i],
  ["clean work", /\bclean(ed)?\s?up\b|\btidy\b|\bleft no mess\b/i],
  ["emergency or same-day", /\bsame[\s-]?day\b|\bemergency\b|\bafter[\s-]?hours\b|\bweekend\b/i],
  ["knowledgeable", /\bknowledge?able\b|\bexpert(ise)?\b|\bthorough\b/i],
  ["would recommend", /\brecommend(ed|ing|ation)?\b/i],
  ["honest", /\bhonest(y)?\b|\btrustworthy\b|\bno pressure\b|\bnot pushy\b/i],
]);

function reviewThemes(quotes) {
  const themes = [];
  for (const [term, pattern] of THEME_TERMS) {
    const mentions = quotes.filter((q) => pattern.test(q.text)).length;
    if (mentions >= 2) themes.push({ term, mentions, source: SOURCES.reviewCount });
  }
  return themes.sort((a, b) => b.mentions - a.mentions);
}

function firstFact(candidates) {
  for (const [value, source] of candidates) {
    const text = trim(value);
    if (text && !hasUnresolvedToken(text)) return { value: text, source };
  }
  return null;
}

function firstNumber(candidates) {
  for (const [value, source] of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return { value: number, source };
  }
  return null;
}

/** First non-empty section wins outright. Sections are never blended. */
function pickSection(...candidates) {
  for (const entries of candidates) if (Array.isArray(entries) && entries.length) return entries;
  return [];
}

// ---------------------------------------------------------------------------
// THE KNOWLEDGE BASE
// ---------------------------------------------------------------------------

/**
 * buildSiteKb({ slug, site, island, settings }) -> kb
 *
 * Pure. No network, no store — which is what makes the law testable: given a
 * real stored record and a real deployed island, the output either names a
 * source for every claim or does not carry the claim.
 */
function buildSiteKb({ slug: rawSlug, site = {}, island = null, settings = null, islandReason = "", now = () => new Date() } = {}) {
  const slug = normalizeSlug(rawSlug || (site && site.slug));
  const refusals = [];
  if (!slug) {
    return { ok: false, slug: "", reason: "invalid_site_slug", absent: [...TOPICS], refusals, sources: [] };
  }

  const record = isObject(site.record) ? site.record : {};
  const contract = contractOf(record);
  const facts = isObject(contract.facts) ? contract.facts : {};
  const content = isObject(contract.content) ? contract.content : {};
  const islandFacts = island && isObject(island.facts) ? island.facts : {};
  const visibleFacts = island && isObject(island._visiblePageFacts)
    && island._visiblePageFacts[VISIBLE_PAGE_PROOF] === true
    ? island._visiblePageFacts
    : {};
  const usable = Boolean(island);

  const business = {
    name: firstFact([
      [islandFacts.business_name, SOURCES.island],
      [facts.business_name, SOURCES.contract],
      [site.businessName, SOURCES.row],
    ]),
    industry: firstFact([[facts.industry, SOURCES.contract]]),
    phone: firstFact([
      [islandFacts.phone, SOURCES.island],
      [facts.phone, SOURCES.contract],
      [site.phone, SOURCES.row],
    ]),
    // ISLAND ONLY, and this asymmetry is the law doing its job. The phone comes
    // off Google's public profile and every donor renders it in a call CTA, so
    // the contract is a safe fallback for it. The EMAIL on a prospect row is
    // the address our own outreach harvested — it is not necessarily printed
    // anywhere on the client's mirror. Handing a stranger an address the site
    // never published is exactly the move this module exists to prevent, so the
    // email is quotable only when the deployed page itself carries it.
    email: firstFact([[islandFacts.email, SOURCES.island]]),
    address: firstFact([
      [islandFacts.address, SOURCES.island],
      [facts.address, SOURCES.contract],
    ]),
    city: firstFact([
      [facts.city, SOURCES.contract],
      [islandFacts.address_city, SOURCES.island],
    ]),
    state: firstFact([
      [facts.state, SOURCES.contract],
      [islandFacts.state, SOURCES.island],
    ]),
    postalCode: firstFact([[facts.postal_code, SOURCES.contract]]),
    siteUrl: { value: `https://${slug}${MIRROR_HOST_SUFFIX}/`, source: SOURCES.island },
    profileUrl: firstFact([[facts.profile_url, SOURCES.contract]]),
    rating: firstNumber([
      [islandFacts.rating, SOURCES.island],
      [facts.rating, SOURCES.contract],
    ]),
    reviewCount: firstNumber([
      [islandFacts.review_count, SOURCES.island],
      [facts.review_count, SOURCES.contract],
    ]),
    bookingUrl: settings && settings.bookingUrl ? { value: settings.bookingUrl, source: SOURCES.ownerSetting } : null,
  };

  const services = pickSection(
    usable ? servicesFrom(island.services, SOURCES.island, refusals) : [],
    servicesFrom(content.services, SOURCES.contract, refusals),
  );
  const faqs = pickSection(
    usable ? faqsFrom(island.faqs, SOURCES.island, refusals) : [],
    faqsFrom(content.faqs, SOURCES.contract, refusals),
  );
  const hours = pickSection(
    usable ? hoursFrom(island.hours, SOURCES.island, refusals) : [],
    hoursFrom(content.hours, SOURCES.contract, refusals),
  );
  const areas = pickSection(
    usable ? areasFrom(island.areas, SOURCES.island, refusals) : [],
    areasFrom(content.areas, SOURCES.contract, refusals),
  );
  const nearbyTowns = usable
    ? nearbyTownsFrom(visibleFacts.nearbyTowns, SOURCES.visiblePage, refusals)
    : [];
  const quotes = pickSection(
    usable ? reviewQuotesFrom(island.reviews, SOURCES.island) : [],
    reviewQuotesFrom(content.reviews, SOURCES.contract),
  );
  const aboutText = usable ? speakable(island.about, MAX.aboutChars) : { text: "", reason: "" };
  const aboutFallback = aboutText.text ? null : speakable(content.about, MAX.aboutChars);
  const about = aboutText.text
    ? { text: aboutText.text, source: SOURCES.island }
    : (aboutFallback && aboutFallback.text ? { text: aboutFallback.text, source: SOURCES.contract } : null);

  const customQa = ((settings && Array.isArray(settings.customQa)) ? settings.customQa : [])
    .map((pair) => ({ question: pair.question, answer: pair.answer, source: SOURCES.ownerQa }));

  if (islandReason) refusals.push({ field: "site_island", value: "", reason: islandReason });
  for (const refusal of (settings && Array.isArray(settings.refusals)) ? settings.refusals : []) {
    refusals.push({ field: refusal.field || "settings", value: trim(refusal.question).slice(0, 80), reason: refusal.reason });
  }

  const known = {
    business_name: Boolean(business.name),
    phone: Boolean(business.phone),
    email: Boolean(business.email),
    address: Boolean(business.address),
    hours: hours.length > 0,
    services: services.length > 0,
    faqs: faqs.length > 0,
    areas: areas.length > 0,
    nearby_towns: nearbyTowns.length > 0,
    about: Boolean(about),
    reviews: quotes.length > 0,
    booking_url: Boolean(business.bookingUrl),
  };

  const sources = [...new Set([
    ...(usable ? [SOURCES.island] : []),
    ...(nearbyTowns.length ? [SOURCES.visiblePage] : []),
    ...(Object.keys(contract).length ? [SOURCES.contract] : []),
    ...(site.prospectId ? [SOURCES.row] : []),
    ...(customQa.length ? [SOURCES.ownerQa] : []),
  ])];

  return {
    ok: true,
    slug,
    generatedAt: now().toISOString(),
    business,
    services,
    faqs,
    hours,
    areas,
    nearbyTowns,
    about,
    reviews: { quotes, themes: reviewThemes(quotes) },
    customQa,
    greeting: settings && settings.greeting ? { value: settings.greeting, source: SOURCES.ownerSetting } : null,
    aiChatEnabled: settings ? settings.aiChatEnabled !== false : true,
    takeoverSeconds: settings ? settings.takeoverSeconds : 30,
    known,
    // NAMED, not merely missing. This list is the assistant's licence to say
    // "I don't know" and hand the visitor to a human.
    absent: TOPICS.filter((topic) => !known[topic]),
    refusals,
    sources,
    counts: {
      services: services.length,
      faqs: faqs.length,
      hours: hours.length,
      areas: areas.length,
      nearbyTowns: nearbyTowns.length,
      reviewQuotes: quotes.length,
      customQa: customQa.length,
    },
  };
}

/** Does the knowledge base actually carry this topic? */
function knows(kb, topic) {
  return Boolean(kb && kb.ok && kb.known && kb.known[topic]);
}

/**
 * kbGroundingBlock(kb) -> string
 *
 * The corpus as the answering layer should receive it: every line traceable,
 * and an explicit inventory of what is NOT known. The second half matters more
 * than the first. A model handed only facts will fill gaps; a model handed
 * facts AND a written list of the gaps has been told, in the same breath, which
 * questions it must hand to a human.
 */
function kbGroundingBlock(kb) {
  if (!kb || !kb.ok) return "";
  const lines = [];
  const b = kb.business;
  const fact = (label, entry) => { if (entry) lines.push(`- ${label}: ${entry.value} [${entry.source}]`); };

  lines.push(`SITE: ${kb.slug}`);
  lines.push("");
  lines.push("PUBLISHED FACTS — you may state these:");
  fact("Business name", b.name);
  fact("Trade", b.industry);
  fact("Phone", b.phone);
  fact("Email", b.email);
  fact("Address", b.address);
  fact("City", b.city);
  fact("State", b.state);
  fact("Website", b.siteUrl);
  fact("Google profile", b.profileUrl);
  fact("Booking link", b.bookingUrl);
  if (b.rating && b.reviewCount) {
    const stamp = b.rating.source === b.reviewCount.source ? b.rating.source : `${b.rating.source}+${b.reviewCount.source}`;
    lines.push(`- Google rating: ${b.rating.value} from ${b.reviewCount.value} reviews [${stamp}]`);
  }

  if (kb.hours.length) {
    lines.push("", "HOURS THE SITE PUBLISHES:");
    for (const h of kb.hours) lines.push(`- ${h.day ? `${h.day}: ` : ""}${h.text} [${h.source}]`);
  }
  if (kb.services.length) {
    lines.push("", `WHAT THE SITE LISTS UNDER SERVICES (${kb.services.length}) — these are the site's own labels, reproduced exactly.`);
    lines.push(`This list is exhaustive: anything not on it is a "let me check that for you and have someone call you back", never a yes:`);
    for (const s of kb.services) lines.push(`- ${s.name}${s.description ? ` — ${s.description}` : ""} [${s.source}]`);
  }
  if (kb.areas.length) {
    lines.push("", "SERVICE AREA THE SITE NAMES:");
    lines.push(`- ${kb.areas.map((a) => a.name).join(", ")} [${kb.areas[0].source}]`);
  }
  // Nearby-town rows are intentionally NOT sent to the language model. They
  // come from rendered HTML outside the signed content island and are answered
  // deterministically by connect-ai-reply. This keeps page text in the data
  // plane and out of the system-instruction plane.
  if (kb.about) {
    lines.push("", "ABOUT, AS THE SITE TELLS IT:");
    lines.push(`${kb.about.text} [${kb.about.source}]`);
  }
  if (kb.faqs.length) {
    lines.push("", "QUESTIONS THE SITE ALREADY ANSWERS:");
    for (const f of kb.faqs) lines.push(`Q: ${f.question}\nA: ${f.answer} [${f.source}]`);
  }
  if (kb.customQa.length) {
    lines.push("", "ANSWERS THE OWNER WROTE HIMSELF — authoritative, quote them freely:");
    for (const f of kb.customQa) lines.push(`Q: ${f.question}\nA: ${f.answer} [${f.source}]`);
  }
  if (kb.reviews.quotes.length) {
    lines.push("", "CUSTOMER REVIEWS PUBLISHED ON THE SITE — quote them as the reviewer's words, never as the business's claim:");
    // Verbatim in the KB, single-line here: a review with paragraph breaks in it
    // would otherwise split into lines that no longer look like a quotation.
    for (const r of kb.reviews.quotes) lines.push(`- "${r.text.replace(/\s+/g, " ").slice(0, 300)}"${r.author ? ` — ${r.author}` : ""} [${r.source}]`);
  }
  if (kb.reviews.themes.length) {
    lines.push("", "WHAT REVIEWERS REPEATEDLY MENTION (counts, not claims):");
    for (const t of kb.reviews.themes) lines.push(`- ${t.term}: ${t.mentions} of ${kb.reviews.quotes.length} reviews [${t.source}]`);
  }

  lines.push("", "NOT PUBLISHED — the site does not say this, so you do not know it.");
  lines.push("Do not estimate, infer, or offer a range. Say you will get the answer and take their contact details:");
  for (const topic of kb.absent) lines.push(`- ${topic}`);
  lines.push("- prices, quotes and availability (never published on this site)");

  return lines.join("\n").slice(0, MAX.groundingChars);
}

// ---------------------------------------------------------------------------
// ORCHESTRATION + CACHE
// ---------------------------------------------------------------------------

const cache = new Map();

function cacheKey(slug, prospectId) {
  return `${slug}\u0000${trim(prospectId)}`;
}

function cacheGet(slug, prospectId, nowMs) {
  const key = cacheKey(slug, prospectId);
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= nowMs) { cache.delete(key); return null; }
  // Re-assert identity on the way out. A cache that can hand back another
  // tenant's answer is worse than no cache.
  return hit.kb && hit.kb.slug === slug && trim(hit.kb.prospectId) === trim(prospectId) ? hit.kb : null;
}

function cacheSet(slug, prospectId, kb, expiresAt) {
  if (cache.size >= MAX.cacheEntries) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(cacheKey(slug, prospectId), { kb, expiresAt });
}

function resetKbCache() {
  cache.clear();
}

/**
 * siteKb(slug) -> kb
 *
 * Resolve the slug to a business we own, read the owner's settings, lift the
 * deployed page's island, and merge. Memoised per lambda for ISLAND_TTL_MS,
 * because the island only changes when the site is rebuilt and a 6-second page
 * fetch on every visitor message is not a chat experience.
 *
 * The page is only ever fetched AFTER the slug resolves to one of our own
 * prospects, so this cannot be used as a fetch proxy for anything.
 */
async function siteKb(siteSlug, {
  select = defaultSelect,
  fetchImpl = globalThis.fetch,
  ttlMs = ISLAND_TTL_MS,
  timeoutMs = FETCH_TIMEOUT_MS,
  now = () => new Date(),
  settings: suppliedSettings = null,
  refresh = false,
} = {}) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return { ok: false, slug: "", reason: "invalid_site_slug", absent: [...TOPICS], refusals: [], sources: [] };

  const nowMs = now().getTime();
  const site = await resolveSite(slug, { select });
  if (!site.ok) return { ok: false, slug, reason: site.reason, absent: [...TOPICS], refusals: [], sources: [] };
  if (!refresh) {
    const hit = cacheGet(slug, site.prospectId, nowMs);
    if (hit) return hit;
  }

  const settings = suppliedSettings || await readSiteSettings(slug, { select });
  const fetched = await fetchSiteIsland(slug, { fetchImpl, timeoutMs });

  const kb = buildSiteKb({
    slug,
    site,
    island: fetched.ok ? fetched.island : null,
    islandReason: fetched.ok ? "" : fetched.reason,
    settings,
    now,
  });
  kb.prospectId = site.prospectId;
  kb.resolvedVia = site.source;
  kb.settingsSource = settings.source;
  kb.settingsReason = settings.reason;

  cacheSet(slug, site.prospectId, kb, nowMs + Math.max(0, Number(ttlMs) || 0));
  return kb;
}

module.exports = {
  MAX,
  SOURCES,
  TOPICS,
  buildSiteKb,
  fetchSiteIsland,
  kbGroundingBlock,
  knows,
  parseContentIsland,
  resetKbCache,
  resolveSite,
  siteKb,
  _test: {
    DAY_RE,
    ISLAND_TTL_MS,
    THEME_TERMS,
    areasFrom,
    cache,
    decideSite,
    faqsFrom,
    hoursFrom,
    nearbyTownsFrom,
    reviewThemes,
    servicesFrom,
    speakable,
    visibleHtmlOnly,
    visiblePageFacts,
  },
};
