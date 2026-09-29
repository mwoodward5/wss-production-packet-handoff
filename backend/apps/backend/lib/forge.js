"use strict";

// lib/forge.js — the donor-forge pipeline as ghost-agency functions.
//
// Ported from the hand-driven session tools (client-dossier.mjs,
// audit-site-vs-dossier.mjs, sanitize-to-boilerplate.mjs) so the AGENCY runs
// the pipeline, not an operator driving 200 tool calls.
//
// Serverless constraints shape everything here:
//  - each stage must finish inside one function invocation
//  - no persistent disk: sites are hydrated in memory and pushed straight to
//    Vercel via the file-hash API
//  - Veo video generation is async by nature -> it is split into submit/poll
//    stages instead of blocking
//
// Stages: dossier -> hydrate -> media_submit -> media_poll -> deploy -> audit -> notify
// State: ghost_agency_prospects.record.forge_job  (advanced one stage per call)

const { createHash } = require("node:crypto");
const { applyBrandToCss } = require("./capture-brand");
// One composer for BOTH lanes. Two headline generators is how the forge lane
// and the mirror lane could have drifted into saying different things about
// the same business on the same day.
const { composeIdentityCopy } = require("./mirror-engine/identity-copy");

// Forge's renderer identity. Defined HERE, in the renderer, because renderer
// identity must come from the renderer's own persisted result — lib/siteforge.js
// imports these (it already requires this module) and accepts the pair.
const FORGE_MIRROR_RENDERER = "ghost-forge-mirror-v1";
const FORGE_MIRROR_QC_CONTRACT = "ghost-forge-audit-v1";
const FORGE_RELEASE_EVIDENCE_SCHEMA = "ghost-forge-release-evidence-v1";

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
function env(name) {
  return String(process.env[name] || "").trim();
}

function geminiKey() {
  return env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");
}

async function gemini(model, body) {
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const j = await res.json();
  if (j.error) throw new Error(`gemini: ${j.error.message}`);
  return j;
}

async function geminiJson(prompt, { maxChars = 14000 } = {}) {
  const j = await gemini("gemini-2.5-flash", {
    contents: [{ parts: [{ text: String(prompt).slice(0, maxChars * 4) }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
  });
  return JSON.parse(j.candidates[0].content.parts[0].text);
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSource(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
    if (!r.ok) return { url, ok: false, status: r.status };
    const html = await r.text();
    const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]).filter((u) => !u.startsWith("data:"));
    return { url, ok: true, text: stripHtml(html).slice(0, 9000), images: [...new Set(imgs)].slice(0, 30) };
  } catch (e) {
    return { url, ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---------------------------------------------------------------------------
// STAGE: dossier — verified facts only, every fact carries its source URL
// ---------------------------------------------------------------------------
const RESONANCE_PROMPT = `Analyze the provided text corpus to generate a resonance profile for a business.
Extract the following:
- tone_profile: An object with four dimensions, each ranging from 0-100:
  - formal_casual: 0 (very formal) to 100 (very casual)
  - serious_funny: 0 (very serious) to 100 (very funny)
  - respectful_irreverent: 0 (very respectful) to 100 (very irreverent)
  - matter_of_fact_enthusiastic: 0 (very matter-of-fact) to 100 (very enthusiastic)
- mirror_words: An array of up to 10 words or short phrases (2-3 words) that reflect the dominant tone and vocabulary of the corpus, suitable for mirroring to build rapport.
- banned_words: An array of up to 10 words or short phrases (2-3 words) to avoid, as they clash with the desired tone or are overused/clichéd.
- rapport_line: A short, engaging sentence (max 20 words) that captures the overall feeling and a suggested way to build rapport with the audience based on the corpus.

Return STRICT JSON:
{"tone_profile":{"formal_casual":0,"serious_funny":0,"respectful_irreverent":0,"matter_of_fact_enthusiastic":0},"mirror_words":["word1","phrase2"],"banned_words":["word1","phrase2"],"rapport_line":"A short sentence to build rapport."}

CORPUS:
{corpus_text}
`;

const DOSSIER_PROMPT = `You are building a factual dossier on a local business so a web studio can build them a site that feels like it was made by someone who has known them for ten years.\n

RULES — absolute:
- Extract ONLY facts explicitly present in the source text. Never infer or fill gaps.
- Every fact MUST include the exact source URL it came from.
- If a fact is absent, OMIT the field. An empty field is correct; an invented one is a defect.
- Report the business's own claims verbatim. Where sources disagree, include both under "conflicts".

Pay special attention to what an OWNER is proud of: certifications, licenses, memberships,
verifications, awards, founding year, review counts, flagship services, origin story, taglines.

Return STRICT JSON:
{"legalOrBrandNames":[{"value":"","source":""}],"phones":[{"value":"","source":""}],
"emails":[{"value":"","source":""}],"address":[{"value":"","source":""}],
"serviceAreaAsStated":[{"value":"","source":""}],"foundingOrYears":[{"value":"","source":""}],
"owners":[{"value":"","source":""}],"certifications":[{"value":"","source":""}],
"memberships":[{"value":"","source":""}],"verifications":[{"value":"","source":""}],
"ratingsAndReviews":[{"value":"","source":""}],"flagshipServices":[{"value":"","source":""}],
"allServices":[{"value":"","source":""}],"taglinesAndVoice":[{"value":"","source":""}],
"originStory":[{"value":"","source":""}],"realImageUrls":[{"value":"","source":""}],
"conflicts":[{"field":"","values":[{"value":"","source":""}]}],
"notFoundButExpected":[""]}`;

/**
 * Merge facts the MINER already attested into the dossier.
 *
 * The dossier is built from the business's website, but the website is not the
 * only source of truth. The mined prospect row carries the Google Business
 * Profile phone, tied to a place_id — that is a real-world attestation, not an
 * invention. Without this merge the audit flags a CONTRADICTION whenever a
 * business lists different numbers on Google and on their own site (verified
 * live: All The Time Plumbing is (713) 630-2882 on Places and (713) 705-3926 on
 * their website — both genuinely theirs), and the build blocks on a fact that
 * was never wrong.
 *
 * The GBP number takes PRECEDENCE (owner directive). It is placed FIRST, which
 * makes it what firstFact() returns and therefore what {{PHONE}} renders. A
 * business's Google listing is the number they maintain for customers and the
 * one Google itself dials — it is more reliable than whatever string happens to
 * sit in a page footer, which is often a stale, departmental, or tracking line.
 *
 * The website number is KEPT, just demoted: it stays in the dossier so the audit
 * still recognises it as a real fact rather than an unsourced contradiction.
 * Nothing verified is ever discarded.
 */
function mergeAttestedFacts(dossier, attested = {}) {
  if (!dossier || dossier.thin) return dossier;
  const norm = (s) => String(s || "").replace(/\D/g, "");
  if (attested.phone) {
    const phones = Array.isArray(dossier.phones) ? dossier.phones : (dossier.phones = []);
    const already = phones.findIndex((p) => norm(p && p.value) === norm(attested.phone));
    if (already >= 0) {
      // present but not first — promote it so {{PHONE}} resolves to the GBP line
      const [existing] = phones.splice(already, 1);
      phones.unshift(existing);
    } else {
      phones.unshift({ value: String(attested.phone), source: attested.source || "google-business-profile" });
    }
  }
  return dossier;
}

async function buildDossier({ businessName, urls = [], attested = {} }) {
  const sources = [];
  for (const u of urls.slice(0, 6)) sources.push(await fetchSource(u));
  const usable = sources.filter((s) => s.ok && s.text && s.text.length > 200);
  if (!usable.length) {
    // Thin-source is a first-class outcome, not an error: the gate must know it
    // has nothing to validate against (Total Tree lesson).
    return {
      thin: true,
      _meta: { businessName, sourcesFetched: [], sourcesFailed: sources.map((s) => ({ url: s.url, reason: s.status || s.error })) },
    };
  }
  const corpus = usable
    .map((s) => `<source url="${s.url}">\n${s.text}\nIMAGES:\n${(s.images || []).join("\n")}\n</source>`)
    .join("\n\n");
  const dossier = await geminiJson(`${DOSSIER_PROMPT}\n\nBUSINESS: ${businessName}\n\nSOURCES:\n${corpus}`);
  dossier.thin = false;
  mergeAttestedFacts(dossier, attested);
  dossier._meta = {
    businessName,
    builtAt: new Date().toISOString(),
    sourcesFetched: usable.map((s) => s.url),
    sourcesFailed: sources.filter((s) => !s.ok).map((s) => ({ url: s.url, reason: s.status || s.error })),
  };
  return dossier;
}

// ---------------------------------------------------------------------------
// STAGE: hydrate — boilerplate {{TOKENS}} -> verified client facts, in memory
// ---------------------------------------------------------------------------
// Boilerplates live in the repo (apps/backend/boilerplates/<name>/) with donor
// assets stripped by sanitize-to-boilerplate.mjs. Text files only + manifest.
const fs = require("node:fs");
const path = require("node:path");

function boilerplateDir(name) {
  return path.join(__dirname, "..", "boilerplates", String(name).replace(/[^a-z0-9-_]/gi, ""));
}

function listBoilerplates() {
  const root = path.join(__dirname, "..", "boilerplates");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const manifest = path.join(root, e.name, "BOILERPLATE.json");
      return fs.existsSync(manifest) ? { name: e.name, ...JSON.parse(fs.readFileSync(manifest, "utf8")) } : null;
    })
    .filter(Boolean);
}

/**
 * The hero video a donor already ships, if any.
 *
 * Owner directive: ambiance heroes are generated ONCE and reused forever. They
 * are deliberately generic — no people, no signage, nothing identifying a
 * business — so one clip serves every client in a vertical. Generating one per
 * customer is pure waste: at ~$0.60 a render and 1000 sites/day that is roughly
 * $18k/month for interchangeable footage, and it is what made forge jobs sit in
 * media_poll for half an hour.
 *
 * When the donor ships its own hero the answer is already on disk and no
 * generation should happen at all.
 */
function donorHeroVideo(boilerplate) {
  const dir = boilerplateDir(boilerplate);
  const mediaDir = path.join(dir, "media");
  if (!fs.existsSync(mediaDir)) return "";
  const found = fs
    .readdirSync(mediaDir)
    .filter((f) => /\.(mp4|webm)$/i.test(f))
    .sort((a, b) => (/hero/i.test(b) ? 1 : 0) - (/hero/i.test(a) ? 1 : 0))[0];
  return found ? `media/${found}` : "";
}

function firstFact(dossier, field, fallback = "") {
  const arr = dossier && dossier[field];
  return Array.isArray(arr) && arr[0] && arr[0].value ? String(arr[0].value) : fallback;
}

/**
 * Join every distinct value on a dossier field into a single display string.
 *
 * Introduced 2026-07-29 for the {{LICENSE}} token. The audit on
 * all-the-time-plumbing found the site says "bonded", "insured", "MPL: 41889"
 * but only the first credential ever surfaced because {{LICENSE}} mapped to
 * firstFact(dossier, "certifications"). Every other verified credential the
 * business owned itself was silently dropped and the audit logged the
 * remainder as certification OMISSIONs.
 *
 * Contract:
 *   · Preserves source order (dossier order = miner discovery order).
 *   · Deduplicates case-insensitively, but returns the FIRST casing seen so
 *     "MPL: 41889" stays uppercase.
 *   · Ignores empty/whitespace values.
 *   · Joins with  ·  (space-middot-space).
 *   · Caps at ~120 characters; if the join would exceed the cap, truncates
 *     to the last full item that fits (never mid-value).
 *   · TRUTH LAW: never invents, pads, or reorders. No verified values ->
 *     returns "" -> the OPTIONAL token collapses its element.
 */
function joinFacts(dossier, field, { separator = " \u00b7 ", cap = 120 } = {}) {
  const arr = dossier && dossier[field];
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const seen = new Set();
  const kept = [];
  for (const entry of arr) {
    if (!entry || !entry.value) continue;
    const value = String(entry.value).trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(value);
  }
  if (kept.length === 0) return "";
  const full = kept.join(separator);
  if (full.length <= cap) return full;
  // Truncate to the last full item that fits — never split a credential mid-string.
  let acc = "";
  for (const v of kept) {
    const next = acc ? acc + separator + v : v;
    if (next.length > cap) break;
    acc = next;
  }
  return acc;
}

/**
 * Return the SECOND distinct phone number from a dossier.
 *
 * Introduced 2026-07-29 for the {{PHONE_ALT}} token. After PR #193 the
 * Google Business Profile phone is unshifted to the front of dossier.phones
 * and resolves as {{PHONE}}. The business's website number sits at index 1+
 * unchanged. The owner wants BOTH numbers shown professionally side by side
 * on the mirror — partly as a deliberate hook for the owner to call Riley
 * and experience a live edit.
 *
 * Distinctness is judged on the last-10-digits suffix so we do not render a
 * second formatting of the same number ("(713) 630-2882" vs "713-630-2882"
 * vs "+1 713 630 2882").
 *
 * TRUTH LAW: no second distinct verified phone -> returns "" -> {{PHONE_ALT}}
 * is OPTIONAL, its element collapses. Never invents a number.
 */
function secondDistinctPhone(dossier) {
  const arr = dossier && dossier.phones;
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);
  const isPhone = (s) => digits(s).length === 10; // reject 'ext. 4', short fragments, empty
  let primary = "";
  for (const entry of arr) {
    if (!entry || !entry.value) continue;
    if (!isPhone(entry.value)) continue;
    const suffix = digits(entry.value);
    if (!primary) { primary = suffix; continue; }
    if (suffix !== primary) return String(entry.value);
  }
  return "";
}

/**
 * Clean an email harvested from a scraped page.
 *
 * roofing-formula-llc-kirkland.wss-ai.com displayed "%20roofingformulanw@outlook.com"
 * — a URL-encoded space that survived into the visible text AND into the mailto:
 * href, which makes the address unusable. It comes from scraping an
 * "mailto:%20name@host" link, where the encoded space is part of the captured
 * value rather than the address.
 *
 * Decodes percent-escapes, strips a stray "mailto:" prefix and surrounding
 * punctuation/whitespace. Returns "" for anything that is not a plausible
 * address, because {{EMAIL}} is OPTIONAL and a blank collapses the element —
 * far better than rendering a broken one.
 */
function sanitizeEmail(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  v = v.replace(/^mailto:/i, "");
  // decode repeatedly: scraped values are sometimes double-encoded
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(v); i++) {
    try { const next = decodeURIComponent(v); if (next === v) break; v = next; } catch { break; }
  }
  v = v.replace(/[\s<>(),;"']+/g, "").trim();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : "";
}

const xmlEscape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A wordmark of the CLIENT's own name, generated deterministically.
 *
 * The boilerplate used to ship the donor's logo image (assets/logo-DmfM0H_8.png),
 * which rendered "TEKLINE ROOFING" in the header of every live customer site next
 * to that customer's own business name. It is an image, so no text scrubber, no
 * residue check and no QC gate ever saw it — only rendering the page did.
 *
 * A generated wordmark is the safe default because it is ALWAYS the client's own
 * identity: there is no path where another company's mark can appear. When we
 * later have the client's real logo from a capture we can prefer that, but the
 * fallback must never be somebody else's brand.
 *
 * textLength + lengthAdjust makes the name span a fixed box, so the mark looks
 * deliberate at any name length without depending on server font metrics.
 */
// accent defaults to currentColor, NOT a fixed hex. A hardcoded dark rule
// (#111827) is invisible on a dark template and a light one vanishes on a pale
// header — and boilerplates vary. currentColor inherits whatever the header
// already uses for text, so the mark is legible on every donor by construction.
// Pass a measured brand colour (see lib/capture-brand.js) to override.
function brandWordmarkSvg(businessName, { accent = "currentColor", fill = "currentColor" } = {}) {
  const name = String(businessName || "").trim() || "Local Service";
  // Aspect ratio matters: the header sizes the mark by HEIGHT, so a wide viewBox
  // renders a wide logo and pushes the nav onto two lines. The donor image it
  // replaces was roughly 3:1, so stay close to that. Long names get set on two
  // lines rather than squeezed into an unreadable strip.
  const words = name.split(/\s+/);
  const twoLine = name.length > 18 && words.length > 1;
  const split = twoLine ? Math.ceil(words.length / 2) : words.length;
  const lines = twoLine ? [words.slice(0, split).join(" "), words.slice(split).join(" ")] : [name];

  const VBW = 420, pad = 16, inner = VBW - pad * 2;
  const VBH = twoLine ? 150 : 120;
  const size = twoLine ? 46 : 56;
  const firstY = twoLine ? 56 : 74;

  const text = lines
    .map(
      (line, i) =>
        `  <text x="${VBW / 2}" y="${firstY + i * (size + 6)}" text-anchor="middle" textLength="${inner}" lengthAdjust="spacingAndGlyphs"
        font-family="'Plus Jakarta Sans','Inter',Arial,Helvetica,sans-serif" font-weight="800" font-size="${size}"
        letter-spacing="0.5" fill="${xmlEscape(fill)}">${xmlEscape(line)}</text>`,
    )
    .join("\n");

  const ruleY = firstY + (lines.length - 1) * (size + 6) + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VBW} ${VBH}" width="${VBW}" height="${VBH}" role="img" aria-label="${xmlEscape(name)}">
${text}
  <rect x="${VBW / 2 - 60}" y="${ruleY}" width="120" height="6" rx="3" fill="${xmlEscape(accent)}"/>
</svg>`;
}

// The hero headline. Factual, and THEIRS.
//
// This was `${Trade} in ${City}.` and nothing else. It is true, it is boring
// on purpose, and it was also the reason two plumbers in one city opened their
// own new websites and read the identical first sentence — measured on 15 of
// the 48 live plumbing mirrors, and byte-identical on all 32 HVAC ones, where
// the donor's own hardcoded line won by default because ours carried nothing
// worth preferring.
//
// Composition now lives in lib/mirror-engine/identity-copy.js so both lanes
// compose the same words from the same verified atoms: their proven motto or
// their name first, trade and market city second, one verified differentiator
// third. Nothing is asserted that a fact did not carry.
function heroHeadline(prospect = {}) {
  return composeIdentityCopy({
    facts: {
      business_name: prospect.business_name,
      industry: prospect.industry || prospect.category,
      city: prospect.city,
      state: prospect.state,
      rating: prospect.rating,
      review_count: prospect.review_count,
    },
    marketCity: prospect.service_area || prospect.city,
  }).headline;
}

function hydrateBoilerplate({ boilerplate, prospect, dossier, brand }) {
  // `brand` is the prospect's OWN measured identity (lib/web-brand.js): their
  // real logo downloaded from their own domain, and the accent color measured
  // from their own published CSS. Optional — absent, the wordmark + donor theme
  // ship, which is safe but generic. It must never be a generated or
  // image-searched substitute; web-brand fails closed on ownership.
  const clientLogo = brand && brand.logo && brand.logo.b64 ? brand.logo : null;
  const dir = boilerplateDir(boilerplate);
  if (!fs.existsSync(dir)) throw new Error(`boilerplate not found: ${boilerplate}`);

  const phoneDigits = String(prospect.phone || "").replace(/\D/g, "").slice(-10);
  const tokens = {
    "{{BUSINESS_NAME}}": prospect.business_name || firstFact(dossier, "legalOrBrandNames"),
    "{{OWNER_NAME}}": firstFact(dossier, "owners", prospect.business_name || ""),
    "{{PHONE}}": prospect.phone || firstFact(dossier, "phones"),
    // OPTIONAL. Second distinct dossier phone (attested GBP -> website line).
    // Blank collapses — no invention, no duplicate formatting.
    "{{PHONE_ALT}}": secondDistinctPhone(dossier),
    "{{EMAIL}}": sanitizeEmail(prospect.email || firstFact(dossier, "emails")),
    "{{DOMAIN}}": prospect.preview_host || "",
    // MARKET vs MAILING ADDRESS. {{CITY}} is what a donor prints in a title, a
    // headline or a "Serving …" line, so it carries the MARKET the business
    // sells into when their own site asserts one (prospect.service_area) and
    // the NAP locality otherwise. {{ADDRESS_CITY}} is the NAP locality and is
    // the only value a PostalAddress or a visible address line may use — the
    // two diverge (Flint Plumbing sells Austin from a Buda address) and pairing
    // a market city with a NAP ZIP is a wrong address, not a headline.
    // See lib/mirror-engine/facts.js marketCity().
    "{{CITY}}": prospect.service_area || prospect.city || "",
    "{{ADDRESS_CITY}}": prospect.city || "",
    "{{REGION}}": prospect.state || "",
    "{{COUNTY}}": prospect.county || "",
    "{{POSTAL}}": prospect.postal_code || "",
    "{{GEO}}": prospect.geo || "",
    "{{LICENSE}}": joinFacts(dossier, "certifications"), // ALL verified credentials, dedup + cap; blank collapses — never invented
    "{{PROFILE_URL}}": firstFact(dossier, "verifications"),
    // --- tokens the boilerplates actually use that were NEVER mapped ---
    // Every token in this object is substituted even when its value is "", so an
    // UNMAPPED token is the only way a literal "{{...}}" reaches a customer. A
    // 2026-07-28 sweep of 69 live previews found raw tokens rendering on 54 of
    // them ("Serving {{COUNTY}}", "{{RATING}} Google reviews"). These eight were
    // present in boilerplates/ but absent here, so they shipped verbatim.
    "{{PREVIEW_DOMAIN}}": prospect.preview_host || "",
    "{{STATE}}": prospect.state || "",          // alias of REGION
    "{{ZIP}}": prospect.postal_code || "",      // alias of POSTAL
    "{{PHONE_DIGITS}}": phoneDigits,            // computed above, previously unused
    // TRUTH LAW: review proof is shown only when it is real. Blank collapses the
    // element; it is never filled with an invented rating, count, quote or name.
    // Inventing these is exactly how "A. Client" fake testimonials shipped.
    "{{RATING}}": prospect.rating ? String(prospect.rating) : "",
    "{{REVIEW_COUNT}}": prospect.review_count ? String(prospect.review_count) : "",
    "{{REVIEW_TEXT}}": firstFact(dossier, "reviewQuotes"),
    "{{REVIEW_AUTHOR}}": firstFact(dossier, "reviewAuthors"),
    "{{ADDRESS}}": prospect.address || "",
    "{{PREVIEW_URL}}": prospect.preview_url || (prospect.preview_host ? `https://${prospect.preview_host}/` : ""),
    // Alias of PREVIEW_URL. The sanitised Lovable donor templates name this field
    // `url` on their BUSINESS object and emit {{SITE_URL}}; canonical, og:url and
    // sitemap entries all build from it. Unmapped, it would ship raw to a customer
    // — which is exactly the failure boilerplate-token-coverage.test.js exists to
    // catch, and why that test scans the boilerplates rather than trusting review.
    "{{SITE_URL}}": prospect.preview_url || (prospect.preview_host ? `https://${prospect.preview_host}/` : ""),
    "{{PLACE_ID}}": prospect.place_id || "",
    "{{GEO_LAT}}": prospect.latitude != null ? String(prospect.latitude) : "",
    "{{GEO_LNG}}": prospect.longitude != null ? String(prospect.longitude) : "",
    // --- hero copy (2026-07-28) ---
    // These three were HARDCODED donor copy inside the compiled bundle:
    // "Roofs built to spec." / "Owner on site." is Falcon Roofing's tagline, and it
    // shipped verbatim on every roofing mirror. It survived every gate because the
    // scrubbers read HTML while the strings lived in minified JS.
    //
    // TRUTH LAW: the headline is a FACT (what they do, where), never a claim. We do
    // not know that any given contractor is owner-led or that the owner attends
    // every job, so we do not say it. A differentiator prints only when the dossier
    // actually verifies one; otherwise it blanks and the element collapses.
    // The client's REAL logo when web-brand captured one from their own
    // domain; otherwise the generated wordmark of their own name. NEVER any
    // asset the boilerplate shipped (donor logo) and never an AI-invented
    // mark — see brandWordmarkSvg for the Tekline incident this encodes.
    "{{LOGO_URL}}": clientLogo ? `/assets/client-logo.${clientLogo.ext || "png"}` : "/assets/brand-logo.svg",
    "{{HERO_HEADLINE}}": heroHeadline(prospect),
    "{{HERO_ACCENT}}": firstFact(dossier, "taglines"),
    "{{HERO_BADGE}}": firstFact(dossier, "taglines"),
  };
  // A blank token must not ship as literal "{{PHONE}}" — hard fail instead, the
  // stage machine surfaces exactly which fact is missing.
  //
  // OPTIONAL means "may legitimately be blank": either the fact is often absent
  // (county, postal, geo), or TRUTH LAW forbids inventing it (licence, profile,
  // and every review field). A blank optional token substitutes to "" and its
  // element collapses — it must never be back-filled with a plausible guess.
  // Anything NOT listed here is required, and a build that lacks it fails loudly
  // rather than shipping a half-filled page.
  const OPTIONAL_TOKENS = new Set([
    "{{LICENSE}}", "{{PROFILE_URL}}", "{{EMAIL}}",
    "{{COUNTY}}", "{{POSTAL}}", "{{ZIP}}", "{{GEO}}",
    "{{DOMAIN}}", "{{PREVIEW_DOMAIN}}", "{{PREVIEW_URL}}",
    "{{RATING}}", "{{REVIEW_COUNT}}", "{{REVIEW_TEXT}}", "{{REVIEW_AUTHOR}}",
    "{{ADDRESS}}", "{{PLACE_ID}}", "{{GEO_LAT}}", "{{GEO_LNG}}",
    // Optional by TRUTH LAW: an unverified differentiator must collapse, never be
    // back-filled with the donor's claim (which is what shipped before).
    "{{HERO_ACCENT}}", "{{HERO_BADGE}}",
    // Second distinct phone (Task 3). If there is only one verified number,
    // the token collapses cleanly — the site still renders with a single line.
    "{{PHONE_ALT}}",
  ]);
  const missing = Object.entries(tokens)
    .filter(([k, v]) => !v && !OPTIONAL_TOKENS.has(k))
    .map(([k]) => k);
  if (missing.length) throw new Error(`hydrate blocked — missing verified facts for: ${missing.join(", ")}`);

  const filesOut = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const rel = path.relative(dir, full).split(path.sep).join("/");
        if (rel === "BOILERPLATE.json" || rel === "DONOR_PROFILE.json" || rel.endsWith(".PLACEHOLDER")) continue;
        let buf = fs.readFileSync(full);
        if (/\.(html|js|css|json|txt|svg|xml|webmanifest)$/i.test(rel)) {
          let s = buf.toString("utf8");
          for (const [tok, val] of Object.entries(tokens)) s = s.split(tok).join(val);
          buf = Buffer.from(s, "utf8");
        }
        filesOut[rel] = buf;
      }
    }
  };
  walk(dir);

  // The client's own wordmark, written AFTER the walk so it is generated from
  // real values rather than passing through token substitution.
  //
  // The fill comes from the BOILERPLATE manifest because contrast is a property
  // of the DONOR, not of the client: currentColor renders legibly on a pale
  // header (roofing-tekline) and disappears into a dark one (roofing-riseabove),
  // and there is no way to infer which from inside this function. Each donor
  // declares `wordmarkFill` once; the default stays currentColor.
  let wordmarkFill = "currentColor";
  try {
    const manifestPath = path.join(dir, "BOILERPLATE.json");
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (m && typeof m.wordmarkFill === "string" && m.wordmarkFill.trim()) {
        wordmarkFill = m.wordmarkFill.trim();
      }
    }
  } catch { /* manifest is optional — currentColor is a safe default */ }

  filesOut["assets/brand-logo.svg"] = Buffer.from(
    brandWordmarkSvg(tokens["{{BUSINESS_NAME}}"], { fill: wordmarkFill, accent: wordmarkFill }),
    "utf8",
  );

  // The client's real logo, when their own site provided one. Written under a
  // name the donor-asset strip below can never match ("client-" prefix), and
  // {{LOGO_URL}} above already points here when clientLogo is set.
  if (clientLogo) {
    filesOut[`assets/client-logo.${clientLogo.ext || "png"}`] = Buffer.from(clientLogo.b64, "base64");
  }

  // Their color, not ours: retheme the donor's accent custom-properties to the
  // accent measured from the client's own published CSS. applyBrandToCss only
  // touches --accent/--accent-glow, so the donor's tuned contrast pairs stay
  // intact. No measured accent -> donor theme unchanged (never a guess).
  if (brand && brand.accent) {
    for (const [rel, buf] of Object.entries(filesOut)) {
      if (!/\.css$/i.test(rel)) continue;
      const { css, changed } = applyBrandToCss(buf.toString("utf8"), { accent: brand.accent });
      if (changed) filesOut[rel] = Buffer.from(css, "utf8");
    }
  }

  // FAIL CLOSED on donor brand assets.
  //
  // A boilerplate cloned from a real company carries that company's logo. If it
  // survives into filesOut it ships to a customer — verified live on
  // roofing-formula-llc-kirkland.wss-ai.com, which rendered "TEKLINE ROOFING" in
  // its header. Nothing else in the pipeline can catch this: it is pixels, not
  // text. Dropping the asset is safe because nothing references it any more —
  // the template now resolves its mark through {{LOGO_URL}}.
  for (const rel of Object.keys(filesOut)) {
    if (rel === "assets/brand-logo.svg") continue;
    if (/(^|\/)assets\/(logo|wordmark|brand|emblem)[-_.][^/]*\.(png|jpe?g|webp|svg)$/i.test(rel)) {
      delete filesOut[rel];
    }
  }

  // strip token leftovers audit
  const leftover = [];
  for (const [rel, buf] of Object.entries(filesOut)) {
    if (!/\.(html|js|css|json|txt|svg|xml)$/i.test(rel)) continue;
    const m = buf.toString("utf8").match(/\{\{[A-Z_]+\}\}/);
    if (m) leftover.push(`${rel}: ${m[0]}`);
  }
  if (leftover.length) throw new Error(`unhydrated tokens remain: ${leftover.slice(0, 5).join("; ")}`);
  return filesOut;
}

// ---------------------------------------------------------------------------
// STAGE: media — logo + hero video via Gemini/Veo (submit + poll split)
// ---------------------------------------------------------------------------
async function generateLogoPng({ businessName, vertical, palette = "deep green and warm gold" }) {
  const j = await gemini("gemini-3-pro-image", {
    contents: [{ parts: [{ text:
      `A clean, professional vector-style logo mark for a ${vertical} business named ${businessName}. ` +
      `Bold modern circular emblem, trade-appropriate iconography, ${palette} palette, flat vector, ` +
      `crisp edges, strong silhouette at small sizes, centered on plain white. NO text, NO letters — icon mark only.` }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  });
  const part = (j.candidates[0].content.parts || []).find((p) => p.inlineData);
  if (!part) throw new Error("logo generation returned no image");
  return Buffer.from(part.inlineData.data, "base64");
}

async function veoSubmit({ prompt, imageBase64, mimeType = "image/jpeg", durationSeconds = 4 }) {
  const key = geminiKey();
  // 4s is the Veo minimum and the hero loops anyway — half the render cost of
  // the 8s default with no visible difference on a looped ambiance hero.
  const duration = Math.max(4, Math.min(8, Math.round(durationSeconds) || 4));
  const body = {
    instances: [{ prompt, ...(imageBase64 ? { image: { bytesBase64Encoded: imageBase64, mimeType } } : {}) }],
    parameters: { aspectRatio: "16:9", durationSeconds: duration },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const j = await r.json();
  if (j.error) throw new Error(`veo submit: ${j.error.message}`);
  return j.name; // operation id
}

async function veoPoll(operation) {
  const key = geminiKey();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operation}?key=${key}`);
  const j = await r.json();
  if (j.error) throw new Error(`veo poll: ${j.error.message}`);
  if (!j.done) return { done: false };
  const uri = j.response.generateVideoResponse.generatedSamples[0].video.uri;
  const v = await fetch(uri, { headers: { "x-goog-api-key": key } });
  return { done: true, video: Buffer.from(await v.arrayBuffer()) };
}

// ---------------------------------------------------------------------------
// STAGE: deploy — Vercel file-hash API straight from memory buffers
// ---------------------------------------------------------------------------
async function vercelDeploy({ files, projectName, aliasHost }) {
  const token = env("VERCEL_TOKEN");
  const teamId = env("VERCEL_TEAM_ID");
  if (!token || !teamId) throw new Error("VERCEL_TOKEN / VERCEL_TEAM_ID not configured");
  const requestedProjectName = String(projectName || "").trim();
  if (!requestedProjectName) throw new Error("Vercel customer project name is required");
  const backendProjectIds = new Set([
    env("VERCEL_PROJECT_ID"),
    "prj_WHDPMZW56KiNFpcKt8DGgsUdxwyU",
  ].filter(Boolean));
  const backendProjectNames = new Set([
    env("VERCEL_PROJECT_NAME"),
    "ghost-agency-backend",
  ].map((value) => value.toLowerCase()).filter(Boolean));
  if (backendProjectNames.has(requestedProjectName.toLowerCase())) {
    throw new Error("Refusing to deploy customer files to the Ghost backend project");
  }
  const q = new URLSearchParams({ teamId }).toString();
  const auth = { Authorization: `Bearer ${token}` };

  // ensure project exists (idempotent)
  const createProjectRes = await fetch(`https://api.vercel.com/v11/projects?${q}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name: requestedProjectName, framework: null }),
  });
  if (!createProjectRes.ok && createProjectRes.status !== 409) {
    const error = await createProjectRes.json().catch(() => ({}));
    throw new Error(`project ensure failed: ${(error.error && error.error.code) || createProjectRes.status}`);
  }
  const projectRes = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(requestedProjectName)}?${q}`,
    { headers: auth }
  );
  const project = await projectRes.json().catch(() => ({}));
  if (!projectRes.ok || !project.id) {
    throw new Error(`project resolve failed: ${(project.error && project.error.code) || projectRes.status}`);
  }
  if (
    String(project.name || "").toLowerCase() !== requestedProjectName.toLowerCase()
    || backendProjectIds.has(project.id)
    || backendProjectNames.has(String(project.name || "").toLowerCase())
  ) {
    throw new Error("Resolved Vercel project is not the requested isolated customer project");
  }
  const customerProjectId = project.id;

  const manifest = [];
  const fileEntries = Array.isArray(files)
    ? files.map(({ file, bytes }) => [file, bytes])
    : Object.entries(files);
  for (const [rel, buf] of fileEntries) {
    const sha = createHash("sha1").update(buf).digest("hex");
    const up = await fetch(`https://api.vercel.com/v2/files?${q}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/octet-stream", "x-vercel-digest": sha },
      body: buf,
    });
    if (!up.ok && up.status !== 409) throw new Error(`file upload failed ${rel}: ${up.status}`);
    manifest.push({ file: rel, sha, size: buf.length });
  }

  const depRes = await fetch(`https://api.vercel.com/v13/deployments?${q}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: requestedProjectName,
      project: customerProjectId,
      target: "production",
      files: manifest,
      projectSettings: { framework: null, buildCommand: null, outputDirectory: null },
    }),
  });
  const dep = await depRes.json();
  if (!depRes.ok) throw new Error(`deployment failed: ${JSON.stringify(dep).slice(0, 300)}`);
  const deployedProjectId = dep.projectId || (dep.project && dep.project.id);
  if (deployedProjectId !== customerProjectId || backendProjectIds.has(deployedProjectId)) {
    throw new Error("Vercel deployed customer files to an unexpected project");
  }

  let state = dep.readyState;
  for (let i = 0; i < 25 && state !== "READY" && state !== "ERROR"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await fetch(`https://api.vercel.com/v13/deployments/${dep.id}?${q}`, { headers: auth }).then((r) => r.json());
    state = s.readyState;
  }
  if (state !== "READY") throw new Error(`deployment state: ${state}`);

  if (aliasHost) {
    const requestedAliasHost = String(aliasHost).trim().toLowerCase();
    if (
      !requestedAliasHost
      || requestedAliasHost.includes("://")
      || requestedAliasHost.includes("/")
      || requestedAliasHost === "ghost-agency-backend.vercel.app"
      || requestedAliasHost === "ghost.wss-ai.com"
    ) {
      throw new Error("Invalid or protected Vercel customer alias");
    }
    const domainRes = await fetch(`https://api.vercel.com/v10/projects/${customerProjectId}/domains?${q}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: requestedAliasHost }),
    });
    if (!domainRes.ok) {
      const existingDomainRes = await fetch(
        `https://api.vercel.com/v9/projects/${customerProjectId}/domains/${encodeURIComponent(requestedAliasHost)}?${q}`,
        { headers: auth }
      );
      const existingDomain = await existingDomainRes.json().catch(() => ({}));
      if (!existingDomainRes.ok || existingDomain.projectId !== customerProjectId) {
        const error = await domainRes.json().catch(() => ({}));
        throw new Error(`domain assignment failed: ${(error.error && error.error.code) || domainRes.status}`);
      }
    }
    const al = await fetch(`https://api.vercel.com/v2/deployments/${dep.id}/aliases?${q}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ alias: requestedAliasHost }),
    });
    if (!al.ok) {
      const aliasesRes = await fetch(`https://api.vercel.com/v2/deployments/${dep.id}/aliases?${q}`, {
        headers: auth,
      });
      const aliasesBody = await aliasesRes.json().catch(() => ({}));
      const aliases = Array.isArray(aliasesBody) ? aliasesBody : (aliasesBody.aliases || []);
      const alreadyBound = aliasesRes.ok && aliases.some((item) => {
        const value = typeof item === "string" ? item : (item.alias || item.domain || "");
        return String(value).toLowerCase() === requestedAliasHost;
      });
      if (!alreadyBound) {
        const error = await al.json().catch(() => ({}));
        throw new Error(`alias assignment failed: ${(error.error && error.error.code) || al.status}`);
      }
    }
    return { url: `https://${dep.url}`, alias: `https://${requestedAliasHost}` };
  }
  return { url: `https://${dep.url}`, alias: null };
}

// ---------------------------------------------------------------------------
// STAGE: audit — the pre-send gate (OMISSION/FABRICATION/CONTRADICTION/PADDING)
// ---------------------------------------------------------------------------
// City->county truth tables are deterministic facts, never LLM judgment. The
// LLM once labeled a WRONG mapping "SUPPORTED" after being told derivation was
// allowed — the lookup table is the fix. Extend per metro as campaigns expand.
const CITY_COUNTY = {
  dallas: "dallas", irving: "dallas", garland: "dallas", mesquite: "dallas",
  richardson: "dallas", "grand prairie": "dallas", "highland park": "dallas",
  "university park": "dallas", carrollton: "dallas", "cedar hill": "dallas",
  duncanville: "dallas", desoto: "dallas", lancaster: "dallas", rowlett: "dallas",
  plano: "collin", frisco: "collin", mckinney: "collin", allen: "collin",
  wylie: "collin", prosper: "collin", celina: "collin",
  denton: "denton", lewisville: "denton", "flower mound": "denton",
  "the colony": "denton", "highland village": "denton", corinth: "denton",
  "fort worth": "tarrant", arlington: "tarrant", "north richland hills": "tarrant",
  euless: "tarrant", bedford: "tarrant", hurst: "tarrant", mansfield: "tarrant",
  keller: "tarrant", southlake: "tarrant", grapevine: "tarrant",
};
const MULTI_COUNTY = {
  frisco: ["collin", "denton"],
  "grand prairie": ["dallas", "tarrant"],
  carrollton: ["dallas", "denton"],
  richardson: ["dallas", "collin"],
  garland: ["dallas", "collin"],
  dallas: ["dallas", "collin", "denton", "rockwall", "kaufman"],
  mansfield: ["tarrant", "johnson", "ellis"],
};

function decodeEsc(s) {
  return String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function normText(s) {
  return decodeEsc(s).toLowerCase().replace(/[®™]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const AUDIT_STOP = new Set(["the","and","for","with","our","your","from","that","are","near","shop","service","services","professional","premium"]);

async function auditSite({ files, dossier }) {
  const findings = [];

  // PADDING: identical image bytes under multiple names
  const seen = new Map();
  for (const [rel, buf] of Object.entries(files)) {
    if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(rel)) continue;
    const h = createHash("md5").update(buf).digest("hex");
    if (!seen.has(h)) seen.set(h, []);
    seen.get(h).push(rel);
  }
  for (const group of seen.values()) {
    if (group.length > 1) findings.push({ severity: "PADDING", detail: `identical image bytes as ${group.length} photos: ${group.join(", ")}` });
  }

  const siteText = Object.entries(files)
    .filter(([rel]) => /\.(html|js|css|json|txt|svg|xml)$/i.test(rel))
    .map(([, buf]) => buf.toString("utf8"))
    .join("\n");

  // FABRICATION: deterministic city->county
  for (const m of siteText.matchAll(/\{name:"([A-Za-z .]+?)\s*County",cities:"([^"]+)"/g)) {
    const county = m[1].trim().toLowerCase();
    for (const rawCity of m[2].split(",")) {
      const city = rawCity.replace(/\barea\b/i, "").trim().toLowerCase();
      const truth = CITY_COUNTY[city];
      if (!truth) continue;
      const allowed = MULTI_COUNTY[city] || [truth];
      if (!allowed.includes(county)) {
        findings.push({ severity: "FABRICATION", detail: `wrong geography: "${rawCity.trim()}" under ${m[1].trim()} County — it is in ${truth} County` });
      }
    }
  }

  if (dossier && !dossier.thin) {
    const siteNorm = normText(siteText);
    const siteWords = new Set(siteNorm.split(" "));

    // OMISSION: pride facts (word-overlap matching; word order varies legitimately)
    for (const field of ["certifications", "memberships", "verifications", "ratingsAndReviews", "flagshipServices", "foundingOrYears", "owners"]) {
      for (const fact of dossier[field] || []) {
        const v = String(fact.value || "");
        if (!v) continue;
        const words = normText(v).split(" ").filter((w) => w.length > 2 && !AUDIT_STOP.has(w));
        if (!words.length) continue;
        const hit = words.filter((w) => siteWords.has(w)).length;
        if (hit / words.length < 0.6) {
          findings.push({ severity: "OMISSION", field, detail: `dossier fact absent: "${v}"`, source: fact.source });
        }
      }
    }

    // CONTRADICTION: founding year
    const dossierYears = (dossier.foundingOrYears || []).map((f) => String(f.value).match(/\b(19|20)\d{2}\b/)?.[0]).filter(Boolean);
    for (const m of siteText.matchAll(/\b(?:Est\.?|Since|Established)\s*((?:19|20)\d{2})\b/gi)) {
      if (dossierYears.length && !dossierYears.includes(m[1])) {
        findings.push({ severity: "CONTRADICTION", detail: `site says established ${m[1]}; sources say ${dossierYears.join("/")}` });
      }
    }

    // CONTRADICTION: phones (formatted or tel: only — bare digit runs are not phones)
    const dossierPhones = (dossier.phones || []).map((p) => String(p.value).replace(/\D/g, "").slice(-10)).filter(Boolean);
    const cand = [
      ...[...siteText.matchAll(/tel:\+?1?(\d{10})\b/g)].map((m) => m[1]),
      ...[...siteText.matchAll(/\(\d{3}\)\s*\d{3}[-.\s]\d{4}/g)].map((m) => m[0]),
      ...[...siteText.matchAll(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g)].map((m) => m[0]),
    ];
    // OUR OWN numbers are not the customer's claims. The preview carries a WSS
    // sales overlay (Riley's line, the agency contact) and template chrome. Those
    // legitimately appear in the page text and will never be in the prospect's
    // dossier, so without this every mirror blocks on a CONTRADICTION about a
    // number we put there ourselves — verified live: sunset-roofing-llc-tucson
    // blocked on 9493395562, the WSS agency line.
    // NOTE: the two literals below are an IGNORE list, not a fallback — they are
    // never rendered into a page or an email. They stay because they are lines
    // we have historically overlaid, and forgetting them re-opens the false
    // CONTRADICTION this block exists to prevent.
    const ourPhones = new Set(
      [
        process.env.GHOST_AGENT_PHONE,
        process.env.GHOST_AGENCY_AGENT_PHONE,
        process.env.GHOST_AGENCY_SUPPORT_PHONE,
        "+19493395562",
        "+19492985562",
      ]
        .map((v) => String(v || "").replace(/\D/g, "").slice(-10))
        .filter((v) => v.length === 10),
    );
    for (const p of [...new Set(cand.map((p) => p.replace(/\D/g, "").slice(-10)))]) {
      if (ourPhones.has(p)) continue;
      if (p.length === 10 && !/^0/.test(p) && dossierPhones.length && !dossierPhones.includes(p)) {
        findings.push({ severity: "CONTRADICTION", detail: `site shows phone ${p} found in no source` });
      }
    }

    // FABRICATION: LLM claim-check (scoped; model severities other than
    // FABRICATION/CONTRADICTION are ignored — it once emitted "SUPPORTED")
    try {
      const literals = [...siteText.matchAll(/"([^"\\]{6,180})"/g)].map((m) => m[1])
        .filter((t) => /[a-z]/i.test(t) && /\s/.test(t) && !/[{}<>]|function|=>|https?:\/\//.test(t));
      const visible = [...new Set(literals)].join("\n").slice(0, 12000);
      const out = await geminiJson(
        `Fact-check a website against its dossier before the owner sees it.\n\nDOSSIER:\n${JSON.stringify(dossier).slice(0, 8000)}\n\nSITE TEXT:\n${visible}\n\n` +
        `Flag ONLY: (a) wrong geography, (b) credentials/licenses/memberships not in dossier, (c) years/counts contradicting dossier, (d) different name/phone/email/address.\n` +
        `DERIVATION ALLOWED: claims that follow necessarily from dossier facts plus public geography are SUPPORTED — do not flag. Name shorthand is not a fabrication.\n` +
        `DO NOT flag service descriptions, marketing voice, or sub-steps of listed services.\n` +
        `Dedupe by root cause. STRICT JSON: {"fabrications":[{"claim":"","why":"","severity":"FABRICATION|CONTRADICTION"}]}`
      );
      const byCause = new Map();
      for (const f of out.fabrications || []) {
        if (!["FABRICATION", "CONTRADICTION"].includes(f.severity)) continue;
        const key = `${f.severity}::${String(f.why || "").slice(0, 90)}`;
        if (!byCause.has(key)) byCause.set(key, { ...f, claims: [] });
        byCause.get(key).claims.push(f.claim);
      }
      for (const g of byCause.values()) {
        findings.push({ severity: g.severity, detail: `${g.why} (${g.claims.length}x: ${g.claims.slice(0, 2).join("; ")})` });
      }
    } catch (e) {
      findings.push({ severity: "AUDIT_DEGRADED", detail: `LLM claim-check failed: ${e.message} — structural checks only` });
    }
  } else {
    findings.push({ severity: "THIN_SOURCES", detail: "dossier too thin to validate claims — manual verification required before prospect contact" });
  }

  const blocking = findings.filter((f) => f.severity === "FABRICATION" || f.severity === "CONTRADICTION").length;
  // THE RENDERER SIGNS ITS OWN WORK (divergence-audit contract, 2026-07-29).
  // These identity fields are the source of truth for what produced this
  // artifact and which gate cleared it. Ghost copies them downstream; it may
  // never overwrite them — the forge_job_mirror branch stamping SiteForge's
  // renderer/QC identifiers onto forge output is the exact defect that
  // destroyed release-evidence integrity.
  return {
    findings,
    blocking,
    verdict: blocking ? "BLOCKED" : findings.length ? "REVIEW" : "PASS",
    renderer: FORGE_MIRROR_RENDERER,
    qc_contract: FORGE_MIRROR_QC_CONTRACT,
  };
}

// Forge's own release evidence: what shipped, who audited it, what it proved.
// Schema-tagged so no consumer can confuse it with SiteForge's
// siteforge-release-evidence-v1 — different renderer, different evidence.
function forgeReleaseEvidence({ job = {}, audit = {} } = {}) {
  return {
    schema: FORGE_RELEASE_EVIDENCE_SCHEMA,
    renderer: FORGE_MIRROR_RENDERER,
    qc_contract: FORGE_MIRROR_QC_CONTRACT,
    verdict: audit.verdict || "",
    blocking: Number(audit.blocking) || 0,
    findings_count: Array.isArray(audit.findings) ? audit.findings.length : 0,
    deploy_alias: job.deploy && typeof job.deploy.alias === "string" ? job.deploy.alias : "",
    boilerplate: job.input && job.input.boilerplate ? String(job.input.boilerplate) : "",
    hydrated_at: job.deployedFilesHydratedAt || "",
    issued_at: new Date().toISOString(),
  };
}

module.exports = {
  mergeAttestedFacts,
  donorHeroVideo,
  sanitizeEmail,
  brandWordmarkSvg,
  heroHeadline,
  buildDossier,
  listBoilerplates,
  hydrateBoilerplate,
  generateLogoPng,
  veoSubmit,
  veoPoll,
  vercelDeploy,
  auditSite,
  forgeReleaseEvidence,
  FORGE_MIRROR_RENDERER,
  FORGE_MIRROR_QC_CONTRACT,
  FORGE_RELEASE_EVIDENCE_SCHEMA,
  // Exposed for tests + future callers that need the same guarantees
  // (order-preserving, case-insensitive dedupe, char-cap, no fabrication).
  firstFact,
  joinFacts,
  // Exposed for tests + future callers.
  secondDistinctPhone,
};
