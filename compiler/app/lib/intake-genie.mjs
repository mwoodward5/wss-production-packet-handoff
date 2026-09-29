import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import * as DB from "./store.mjs";
import * as U from "./util.mjs";
import * as Engine from "./engine-adapter.mjs";
import * as Discovery from "./discovery.mjs";
import { collectSourceIntake, isServiceSectionHeading, promoteIdentityMatchedSourceLogo, sanitizeSourceAssets, socialBelongsToBusiness, sourceFieldsFromPrompt } from "./source-intake.mjs";
import { prepareIntakeFiles } from "./intake-files.mjs";
import { enrichRemoteImageAssets } from "./image-metadata.mjs";
import { assessMinimumContent, sanitizeContactFacts } from "./intake-content-gate.mjs";
import {
  buildCanonicalPacket,
  cacheKeyFor,
  categoryDefaultServices,
  deriveFacts,
  detectScope,
  evidenceForFacts,
  missingFactResponse,
  normalizeInput,
  shouldDiscoverBeforeScope,
  sourceDiscoveryIsBound,
  validateCanonicalPacket,
  VERSION,
} from "./intake-genie-core.mjs";

const CACHE_DIR = path.join(DB.DATA_DIR, "intake-genie-cache");
const IDEMPOTENCY = new Map();

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

function readCache(key) {
  const fp = cachePath(key);
  if (!existsSync(fp)) return null;
  try {
    const data = JSON.parse(readFileSync(fp, "utf8"));
    if (Date.now() - Date.parse(data.created_at || 0) > 24 * 3600_000) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(key), JSON.stringify({ created_at: U.nowIso(), ...data }, null, 2));
}

function expiresAt() {
  return new Date(Date.now() + 24 * 3600_000).toISOString();
}

function cleanExpiredEphemeral() {
  const expired = DB.where("site_projects", (project) => project.ephemeral && project.expires_at && project.expires_at < U.nowIso());
  for (const project of expired) {
    for (const table of ["business_profiles", "business_assets", "site_generations", "site_qc_reports", "jobs", "audit_logs"]) {
      const rows = DB.where(table, (row) => row.project_id === project.id || row.subject === project.id);
      rows.forEach((row) => DB.remove(table, row.id));
    }
    rmSync(DB.siteDirFor(project.id, 1).split(`${path.sep}v`)[0], { recursive: true, force: true });
    DB.remove("site_projects", project.id);
  }
}

function sourceProfile(input, facts) {
  return {
    business_name: facts.name || "Intake Preview",
    city: facts.city || "",
    state: facts.state || "",
    industry: facts.category || "",
    website: input.sources.website_url || null,
    gbp_url: input.sources.gbp_url || null,
  };
}

async function discoverOnCacheMiss(input, facts) {
  const sourceIntake = await collectSourceIntake(input, facts);
  if (sourceIntake?.summary?.pages_read || sourceIntake?.assets?.length || sourceIntake?.files?.length || input.sources.asset_url) {
    return {
      project_id: "",
      found: sourceIntake.found || {},
      facts: sourceIntake.facts || {},
      // The crawled-page URL list feeds the packet's source observations —
      // services are only certifiable when tied to pages actually read.
      sources: sourceIntake.sources || [],
      assets: sanitizeSourceAssets(sourceIntake.assets || []),
      files: sourceIntake.files || [],
      image_inventory: sourceIntake.image_inventory || [],
      navigation_pages: sourceIntake.navigation_pages || [],
      summary: sourceIntake.summary,
    };
  }
  if (!input.sources.website_url && !input.sources.gbp_url) return null;
  cleanExpiredEphemeral();
  const profile = sourceProfile(input, facts);
  const project = DB.insert("site_projects", {
    id: U.id("ig"),
    user_id: null,
    ephemeral: true,
    expires_at: expiresAt(),
    name: profile.business_name,
    slug: `intake-${U.kebab(profile.business_name)}-${U.token(3).toLowerCase()}`,
    status: "intake_discovery",
    city: profile.city,
    state: profile.state,
    industry: profile.industry,
    next_version: 1,
  });
  DB.insert("business_profiles", { project_id: project.id, ephemeral: true, expires_at: project.expires_at, ...profile });
  try {
    const result = await Discovery.runDiscovery({ user: { id: null }, project, profile });
    return {
      project_id: project.id,
      found: result.found || {},
      assets: sanitizeSourceAssets((result.assets || []).map((asset) => ({ kind: asset.kind, url: asset.url || "", label: asset.label || "", source: asset.source || "business-evidence", origin: asset.origin, approved: asset.approved, meta: asset.meta }))).slice(0, 16),
      summary: {
        mode: result.mode,
        photos_found: result.photos_found || 0,
        services_found: result.services_found || 0,
        map_found: Boolean(result.map_found),
      },
    };
  } catch (error) {
    DB.update("site_projects", project.id, { status: "intake_discovery_failed", discovery_error: error.message || String(error) });
    return { project_id: project.id, found: {}, assets: [], summary: { error: error.message || String(error) } };
  }
}

export function factsFromDiscovery(input, facts, discovery) {
  const found = discovery?.found || {};
  const sourceFacts = discovery?.facts || {};
  const hours = sourceFacts.hours || found.hours || hoursFromAssets(discovery?.assets);
  const bookingUrl = sourceFacts.booking_url || found.booking_url || bookingUrlFromCopy(found.copy);
  const enriched = normalizeInput({
    website_url: input.sources?.website_url || sourceFacts.website,
    gbp_url: input.sources?.gbp_url || sourceFacts.gbp_url,
    social_url: input.sources?.social_url,
    asset_url: input.sources?.asset_url,
    description: [input.description, found.copy || "", ...(found.services || [])].filter(Boolean).join(" "),
    name: facts.name || sourceFacts.name,
    city: facts.city,
    state: facts.state,
    category: facts.category,
    phone: facts.phone,
    address: facts.address,
  });
  const derived = deriveFacts(enriched).facts;
  const address = validAddress(sourceFacts.address || found.contact?.address || "");
  const sourceLocation = locationFromAddress(address)
    || (!facts.state && sourceDiscoveryIsBound(input, discovery)
      ? locationFromObservedCopy(found.copy, facts.city || derived.city)
      : null);
  const websiteOwnsLocation = Boolean(
    sourceLocation &&
    input.sources?.website_url &&
    !input.sources?.gbp_url &&
    (!facts.state || facts.state === sourceLocation.state),
  );
  const city = websiteOwnsLocation ? sourceLocation.city : (facts.city || derived.city);
  // deriveFacts(enriched) sees raw crawl prose, where a footer button or an
  // unrelated service-area mention can look like a state. The pre-discovery
  // facts already contain any operator-provided or prompt-derived state.
  const state = websiteOwnsLocation ? sourceLocation.state : facts.state;
  // IDENTITY MERGE LAW (owner directive 2026-09-19): prefer corroborated
  // source identity over weak prompt inference, and reject genuine
  // conflicting identity. A freeform-prose inference (name_source
  // "inferred"/"domain") never overrides what the business's own website says
  // it is; an operator-typed hint that CONTRADICTS the website is a blocked
  // conflict, never a silent pick.
  const identity = resolveBusinessIdentity({
    promptName: facts.name || "",
    promptSource: facts.name_source || derived.name_source || "",
    siteName: sourceFacts.name || "",
    fallbackName: derived.name || "",
    city: facts.city || derived.city,
  });
  return {
    ...facts,
    name: identity.name,
    ...(identity.corroborated ? { name_corroboration: identity.corroborated } : {}),
    ...(identity.overridden ? { name_override: identity.overridden } : {}),
    ...(identity.conflict ? { name_conflict: identity.conflict } : {}),
    city,
    state,
    category: facts.category || derived.category,
    phone: sourceFacts.phone || found.contact?.phone || facts.phone || "",
    email: sourceFacts.email || found.contact?.email || "",
    address: address || facts.address || "",
    location_source: websiteOwnsLocation ? "website-address" : "prospect-hint",
    location_conflict: websiteOwnsLocation && facts.city && facts.city.toLowerCase() !== sourceLocation.city.toLowerCase()
      ? { supplied: `${facts.city}, ${facts.state}`, source: `${sourceLocation.city}, ${sourceLocation.state}`, resolution: "website-address" }
      : null,
    website: input.sources?.website_url || sourceFacts.website || "",
    hours,
    booking_url: bookingUrl,
    // Real scraped/hinted services always win. When every extractor comes back
    // empty (prose-heavy vertical sites), fall back to the honest
    // category-standard menu (confirmed by the business at activation) instead
    // of hard-failing the source-evidence gate.
    services: (() => {
      const merged = cleanServices((facts.services || []).length ? facts.services : (sourceFacts.services || found.services || []), sourceFacts.name || facts.name || "");
      if (merged.length) return merged;
      return categoryDefaultServices(facts.category || derived.category || "");
    })(),
    services_source: (() => {
      const merged = cleanServices((facts.services || []).length ? facts.services : (sourceFacts.services || found.services || []), sourceFacts.name || facts.name || "");
      if (merged.length) return "extracted";
      return categoryDefaultServices(facts.category || derived.category || "").length ? "category_default" : "";
    })(),
    // The crawler's own extractions, kept SEPARATE from the (possibly
    // claimed) primary list. Downstream service admission treats these as
    // source-bound by construction (owner directive 2026-09-19: preserve real
    // source-supported services), while claims keep the strict
    // allowlist/evidence police.
    discovered_services: cleanServices(found.services || [], sourceFacts.name || facts.name || ""),
    socials: cleanSocials(input, sourceFacts.socials || found.socials || [], sourceFacts.name || facts.name || "", input.sources?.website_url || sourceFacts.website || ""),
    // G2 (E8): full-content intake — real copy, attributed testimonials, and
    // founding year flow into the build so the site reads like THEIR site.
    copy: String(found.copy || "").slice(0, 18000),
    testimonials: extractTestimonials(found.copy),
    founded: extractFoundedYear(found.copy),
  };
}

export function hoursFromAssets(assets = []) {
  const row = (Array.isArray(assets) ? assets : []).find((asset) => asset?.kind === "hours");
  return String(row?.label || "").trim().slice(0, 500) || null;
}

export function bookingUrlFromCopy(copy = "") {
  const match = String(copy || "").match(/https?:\/\/(?:www\.)?(?:calendly\.com|cal\.com|acuityscheduling\.com|squareup\.com\/appointments|square\.site\/book|booksy\.com)\/[^\s)\]>'\"]+/i);
  return match ? match[0].replace(/[.,;]+$/, "") : "";
}

// Address junk guard (G7/E8): scraped "addresses" were matching random copy.
// Accept only street-number + street-suffix shapes.
function validAddress(value = "") {
  const text = String(value).trim().split(/\s+\/\s+|[\r\n;]+/)[0].trim().slice(0, 120);
  return /^\d{1,6}\s+[A-Z0-9][A-Za-z0-9 .'-]*\b(St|Street|Ave|Avenue|Blvd|Boulevard|Road|Rd|Dr|Drive|Ln|Lane|Way|Hwy|Highway|Court|Ct|Cir|Circle|Pl|Place)\b/i.test(text) ? text : "";
}

export function locationFromAddress(value = "") {
  const text = validAddress(value);
  if (!text) return null;
  const match = text.match(/\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Road|Rd|Dr|Drive|Ln|Lane|Way|Hwy|Highway|Court|Ct|Cir|Circle|Pl|Place)\b\.?,?\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s*,?\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
  if (!match) return null;
  return {
    city: match[1].replace(/\s+/g, " ").trim(),
    state: match[2].toUpperCase(),
  };
}

const US_STATE_CODES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));

// Only an owned crawl's postal locality may fill a URL-only location. A
// country token, city marketing phrase, or conflicting set of addresses is
// insufficient evidence for a state.
function locationFromObservedCopy(copy = "", expectedCity = "") {
  const matches = [...String(copy).matchAll(/\b([A-Z][A-Za-z .'-]{1,40}?)\s*,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/g)]
    .map((match) => ({ city: match[1].replace(/\s+/g, " ").trim(), state: match[2] }))
    .filter(({ city, state }) => US_STATE_CODES.has(state)
      && (!expectedCity || city.toLowerCase() === String(expectedCity).trim().toLowerCase()));
  const unique = [...new Map(matches.map((row) => [`${row.city.toLowerCase()}|${row.state}`, row])).values()];
  return unique.length === 1 ? unique[0] : null;
}

// Testimonials: only quotes that carry a real attribution on/near the line —
// never mistake the business's own marketing for a customer's words.
function extractTestimonials(copy = "") {
  const out = [];
  const lines = String(copy || "").split(/\n+/).map((line) => line.replace(/^[>*\s#-]+/, "").replace(/[*_`]/g, "").trim());
  const isName = (value) => /^[A-Z][a-z'’.]+(?:\s+[A-Z][a-zA-Z'’.]*){0,3}$/.test(value) && value.length <= 40;
  for (let i = 0; i < lines.length && out.length < 4; i += 1) {
    let text = lines[i];
    let author = "";
    const inline = text.match(/^[“"']?(.{60,340}?)[”"']?\s*[—–-]\s*([A-Z][A-Za-z'’. ]{2,40})$/);
    if (inline) { text = inline[1].trim(); author = inline[2].trim(); }
    else {
      const next = (lines[i + 1] || "").replace(/^[—–-]\s*/, "").trim();
      const quoted = /^[“"'].{60,340}[”"']$/.test(text);
      if (quoted && isName(next)) { text = text.replace(/^[“"']|[”"']$/g, "").trim(); author = next; }
    }
    if (!author || text.length < 60 || text.length > 340) continue;
    if (!/\b(I|we|my|our|us|they|he|she)\b/i.test(text)) continue;
    if (out.some((t) => t.text === text)) continue;
    out.push({ author: author.replace(/[.,]+$/, ""), text });
  }
  return out;
}

function extractFoundedYear(copy = "") {
  const m = String(copy || "").match(/\b(?:since|established(?: in)?|est\.?|founded(?: in)?|serving[^.\n]{0,40}since)\s+((?:19|20)\d{2})\b/i);
  if (!m) return null;
  const year = Number(m[1]);
  const age = new Date().getFullYear() - year;
  return age >= 1 && age <= 80 ? year : null;
}

// G6 (E8): scraped service lists can contain markdown nav links — never let
// link syntax or URLs pose as services.
const NAV_WORDS = /^(services?|our services|service areas?|home|about( us)?|contact( us)?|gallery|projects?|reviews?|testimonials?|faq|blog|menu|get a quote|request a quote|portfolio|professional services|our work|our company|our process|(?:(?:our|the|recent|latest)\s+)?(?:(?:project|photo)\s+)?(?:galler(?:y|ies)|portfolio|projects?))$/i;
const GENERIC_SERVICE_FIELD = /^(?:service(?:\s+type)?|type\s+of\s+service|requested\s+service|service\s+(?:needed|required)|select\s+(?:a\s+)?service|choose\s+(?:a\s+)?service)\s*[/\\|:;,.!?*_()-]*$/i;
export function cleanServices(list = [], businessName = "") {
  const name = String(businessName || "").toLowerCase();
  return list
    .map((item) => normalizeServiceLabel(String(item || "").replace(/^[-*•#>\s\[\"'“”]+/, "").replace(/[\"'“”]+$/, "").trim()))
    .filter((item) => item && item.length >= 3 && item.length <= 52 && !/https?:\/\/|\]\(|www\./i.test(item))
    .filter((item) => !NAV_WORDS.test(item) && !isServiceSectionHeading(item))
    .filter((item) => !GENERIC_SERVICE_FIELD.test(item))
    .filter((item) => !/[?!]$/.test(item) && !/^(new|why|how|what|when|where)\b.*\?/i.test(item))
    .filter((item) => !/^(street ?address|city|state|zip ?code|postal code|first name|last name|full name|your name|email( address)?|phone( number)?|message|subject|company|comment|services we offer|what is|how (much|do|can)|read more|learn more|click here)\b/i.test(item))
    .filter((item) => !/street ?address|zip ?code|\bcity\b|postal code|first name|last name|\bemail\b|phone number|\bmessage\b|services we offer/i.test(item))
    .filter((item) => { const words = item.split(/\s+/).length; return words <= 3 || (words <= 5 && /&|\band\b/i.test(item)); })
    // concatenated nav runs ("servicescommercialresidentialsynthetic") sneak in
    // as one giant token — no real service name has an 18+ char word
    .filter((item) => item.split(/\s+/).every((word) => word.length <= 18))
    .filter((item) => !name || !item.toLowerCase().includes(name.slice(0, Math.min(name.length, 12))))
    .filter((item, index, values) => values.findIndex((value) => value.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 10);
}

function normalizeServiceLabel(value = "") {
  let label = String(value).replace(/\s*[-–—:]+\s*$/, "").replace(/\s+/g, " ").trim();
  if (label && label === label.toUpperCase() && /[A-Z]/.test(label)) {
    label = label.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    label = label.replace(/\bAnd\b/g, "and").replace(/\bHvac\b/g, "HVAC").replace(/\bAc\b/g, "AC");
  }
  return label;
}

export function normalizeBusinessName(value = "", city = "") {
  let name = String(value).replace(/[,]/g, "").replace(/\.(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
  // G1 (E8): scraped og/title tags carry SEO tails ("Brand – Orange CA Experts",
  // "Brand | Official Site") that break forgePacket's fact parsing downstream.
  const parts = name.split(/\s+[|–—·]\s+|\s+-\s+/);
  if (parts.length > 1) {
    const tail = parts.slice(1).join(" ");
    if (/expert|official|home ?page|welcome|best|top rated|#1|serving|near me|\b[A-Z]{2}\b/i.test(tail)) name = parts[0].trim();
  }
  if (city) name = name.replace(new RegExp(`\\s+(?:in|serving)\\s+${escapeRegExp(city)}$`, "i"), "").trim();
  return name.slice(0, 100);
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fuzzy business-identity comparison for corroboration: legal suffixes and
 * punctuation carry no identity, so the token sets must substantially
 * overlap (or one name must contain the other) to count as the same business.
 */
export function sameBusinessIdentity(a = "", b = "") {
  const left = identityTokenSet(a);
  const right = identityTokenSet(b);
  if (!left.size || !right.size) return false;
  const joined = (set) => [...set].sort().join(" ");
  if (joined(left) === joined(right)) return true;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size) >= 0.5;
}

/**
 * A scraped slogan is not a business identity ("Concrete Built for Every
 * Season"). When every token of the discovered name is trade vocabulary or
 * generic quality-speak, the site has not actually told us its name — the
 * operator-supplied name keeps standing (test law: "a scraped slogan cannot
 * overwrite independent identity").
 */
const SLOGAN_WORDS = new Set(("roofing roofer concrete plumbing plumbing plumber landscaping landscaping lawn "
  + "fence fencing electrical electric electrician heating air cooling hvac painting painter cleaning cleaner "
  + "service services company co corp inc llc ltd contractor contractors construction contractor "
  + "built build building every season quality trusted trust expert experts best top premier pride proud "
  + "serving serve your you our the and for all needs care cares solutions solution done right with since "
  + "local affordable reliable professional professionals licensed insured free estimate call today us we "
  + "america american number one 1st specialist specialists repair repairs installation installations "
  + "maintenance improvements improvement contracting enterprises group partners").split(" "));

function looksLikeSlogan(name = "") {
  const tokens = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
  if (!tokens.length) return false;
  return tokens.every((word) => SLOGAN_WORDS.has(word) || /^\d+$/.test(word));
}

function identityTokenSet(value = "") {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !/^(?:llc|ltd|inc|incorporated|corp|corporation|co|company|limited|the|and)$/.test(word)),
  );
}

/**
 * THE IDENTITY MERGE LAW (owner directive 2026-09-19): "Prefer corroborated
 * source identity over weak prompt inference, while rejecting genuine
 * conflicting identity." The website's own discovered name is the strong
 * identity; the freeform prompt contributes either an explicit operator hint
 * or weak inference. Returns the merged name plus, where relevant, the
 * corroboration/override/conflict evidence the packet records.
 */
export function resolveBusinessIdentity({ promptName = "", promptSource = "", siteName = "", fallbackName = "", city = "" } = {}) {
  const site = normalizeBusinessName(siteName || "", city);
  const prompt = normalizeBusinessName(promptName || "", city);
  if (!site) {
    return { name: prompt || normalizeBusinessName(fallbackName || "", city) };
  }
  if (!prompt) {
    // The site's own name is only an identity when it is one — a scraped
    // slogan never becomes the business's name by default either.
    if (looksLikeSlogan(site)) {
      return { name: normalizeBusinessName(fallbackName || "", city), slogan_ignored: { source: siteName, reason: "scraped_slogan_is_not_identity" } };
    }
    return { name: site };
  }
  if (looksLikeSlogan(site)) {
    return { name: prompt, slogan_ignored: { source: siteName, reason: "scraped_slogan_is_not_identity" } };
  }
  if (sameBusinessIdentity(prompt, site)) {
    // Corroborated identity, two spellings. Scrape tails append generic
    // trade-descriptor words to the clean name; when one token set strictly
    // contains the other, the SHORTER set is the clean identity (same
    // doctrine as normalizeBusinessName's SEO-tail strip).
    const promptTokens = identityTokenSet(prompt);
    const siteTokens = identityTokenSet(site);
    const shorterIsPrompt = promptTokens.size < siteTokens.size
      && [...promptTokens].every((word) => siteTokens.has(word));
    const shorterIsSite = siteTokens.size < promptTokens.size
      && [...siteTokens].every((word) => promptTokens.has(word));
    const name = shorterIsPrompt ? prompt : site;
    return { name, corroborated: { supplied: promptName, source: siteName, resolution: shorterIsPrompt || shorterIsSite ? "cleaner_spelling_preferred" : "source_spelling_preferred" } };
  }
  if (promptSource === "hint") {
    // An explicit operator claim that contradicts the business's own website
    // is a genuine identity conflict: blocked for human confirmation, never
    // silently resolved in either direction.
    return {
      name: site,
      conflict: { supplied: promptName, source: siteName, resolution: "blocked_identity_conflict" },
    };
  }
  // Weak prose inference loses to the corroborated source identity, and the
  // override is recorded so the packet stays auditable.
  return {
    name: site,
    overridden: { from: promptName, to: siteName, reason: "weak_prompt_inference_replaced_by_source_identity" },
  };
}

function cleanSocials(input, values = [], businessName = "", website = "") {
  const supplied = input.sources?.social_url || "";
  return [...new Set([supplied, ...(Array.isArray(values) ? values : [])].filter(Boolean))]
    .filter((url) => url === supplied || socialBelongsToBusiness(url, businessName, website))
    .slice(0, 6);
}

export function familyForBusiness(facts = {}) {
  const text = String(facts.category || "").toLowerCase();
  const candidates = /tattoo/.test(text)
    ? ["split-editorial-index", "cinematic-video-parallax", "magazine-owner-letter"]
    : /pool|concrete|paint/.test(text)
    ? ["cinematic-video-parallax", "material-lab-swatch", "atlas-grid-reveal"]
    : /landscap|tree/.test(text)
      ? ["split-editorial-index", "cinematic-video-parallax", "magazine-owner-letter", "atlas-grid-reveal"]
      : /roof|plumb|hvac|electric|solar|garage/.test(text)
        ? ["cinematic-video-parallax", "service-map-pins", "split-editorial-index"]
        : ["split-editorial-index", "magazine-owner-letter", "atlas-grid-reveal"];
  const seed = `${facts.name || ""}|${facts.city || ""}|${facts.category || ""}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return candidates[(hash >>> 0) % candidates.length];
}

export function previewFamilyForBusiness(facts = {}) {
  return String(facts.category || "").toLowerCase() === "tattoo studio"
    ? familyForBusiness(facts)
    : "auto";
}

export function requireMachineAuth(req) {
  const token = process.env.INTAKE_GENIE_TOKEN || process.env.SITEFORGE_INTAKE_GENIE_TOKEN || "";
  if (!token) return { ok: false, status: 503, error: "INTAKE_GENIE_TOKEN is not configured." };
  const header = String(req.headers["authorization"] || req.headers["x-intake-genie-token"] || "");
  const supplied = header.replace(/^Bearer\s+/i, "").trim();
  if (!supplied || !U.timingSafeEq(supplied, token)) return { ok: false, status: 401, error: "Unauthorized Intake Genie request." };
  return { ok: true };
}

export async function compileFromInput(rawInput = {}, options = {}) {
  const preparedFiles = prepareIntakeFiles(rawInput._files);
  const suppliedDescription = Engine.stripUnsupportedReviewClaims(rawInput.description || rawInput.prompt || rawInput.text || "");
  const combinedDescription = [suppliedDescription, preparedFiles.extractedText].filter(Boolean).join("\n\n");
  const inferredSources = sourceFieldsFromPrompt(combinedDescription);
  const input = normalizeInput({ ...inferredSources, ...rawInput, description: combinedDescription }, { allowPrivate: options.allowPrivate });
  const trustedBrandReview = options.trustedBrandReview;
  if (trustedBrandReview?.verified === true
    && ["owner_upload", "admin_review", "official_source"].includes(String(trustedBrandReview.verification_source || ""))) {
    input.brand_review = {
      ...input.brand_review,
      verified: true,
      trusted_context: true,
    };
  }
  const key = cacheKeyFor(input);
  const cachedResult = readCache(key);
  // Empty/manual discovery results are never authoritative for a supplied
  // website. Retry the live source path instead of preserving a blank packet.
  const cached = cacheHasSourceEvidence(cachedResult, input) ? cachedResult : null;
  const cache = { hits: cached ? 1 : 0, misses: cached ? 0 : 1, key };
  let { facts, missing, scope } = deriveFacts(input);

  if (!scope.supported && !shouldDiscoverBeforeScope(input, scope)) {
    return { ok: true, version: VERSION, status: "out_of_scope", scope, facts, evidence: evidenceForFacts(input, facts), cache, warnings: ["out_of_scope"] };
  }
  // The shared discovery path is deliberately invoked only for an active
  // Intake Genie cache miss. Existing SiteForge discovery callers remain
  // untouched, and repeat URLs reuse evidence for the short preview window.
  const discovery = cached?.discovery || await discoverOnCacheMiss(input, facts);
  if (discovery?.assets?.length) {
    // Probe up to 24 photos so large hero candidates get VERIFIED dimensions
    // (tiny thumbnails were consuming the 12 probe slots, leaving real hero
    // photos dimensionless and outside the production-upscale safety filter).
    await enrichRemoteImageAssets(discovery.assets, { limit: 24, concurrency: 6, timeoutMs: 5000 });
    promoteIdentityMatchedSourceLogo(discovery, {
      name: facts.name || discovery.facts?.name,
      website: input.sources.website_url || facts.website || discovery.facts?.website,
    });
  }
  if (input.sources.asset_url && discovery?.summary?.errors?.length && !discovery?.assets?.length && !discovery?.files?.length && !discovery?.summary?.pages_read) {
    const error = new Error(discovery.summary.errors[0]);
    error.status = 422;
    throw error;
  }
  if (discovery) {
    facts = factsFromDiscovery(input, facts, discovery);
    missing = [];
    if (!facts.name) missing.push("name");
    if (!facts.city || !facts.state) missing.push("location");
    if (!facts.category) missing.push("trade");
    scope = detectScope({ ...input, prospect_hints: { ...input.prospect_hints, category: facts.category } });
  }
  if (missing.length === 1) {
    return { ok: true, version: VERSION, status: "needs_input", scope: { supported: true, category: scope.category, message: "" }, ...missingFactResponse(missing), facts, evidence: evidenceForFacts(input, facts), cache };
  }
  if (missing.length > 1) {
    return { ok: false, version: VERSION, status: "blocked", scope: { supported: true, category: scope.category, message: "" }, missing_facts: missing, facts, evidence: evidenceForFacts(input, facts), cache, error: "More business facts are needed before a preview can be built." };
  }

  const minimumContent = assessMinimumContent({ input, facts, discovery });
  if (!minimumContent.ok) {
    const evidence = evidenceForFacts(input, facts);
    return {
      ok: false,
      version: VERSION,
      status: "blocked",
      code: minimumContent.code,
      scope: { supported: true, category: scope.category, message: "" },
      facts,
      evidence,
      cache,
      error: minimumContent.reason,
    };
  }
  facts = sanitizeContactFacts(facts, minimumContent.source_contact);
  const evidence = evidenceForFacts(input, facts, minimumContent.source_contact);
  const sourceAssets = sanitizeSourceAssets(
    discovery?.assets || cached?.assets || (input.sources.asset_url ? [{ kind: "asset_folder", url: input.sources.asset_url, source: "owner-supplied", origin: "owner-supplied", status: "linked_not_imported" }] : []),
  );
  let preview = {};
  if (input.build_preview) {
    const startPreview = Engine.SERVERLESS && !options.awaitPreview ? Engine.startTryOnStaged : Engine.startTryOn;
    const { job, done } = await startPreview({
      // Tattoo requires an editorial/cinematic family; established verticals
      // retain the existing fresh automatic family selection.
      family: previewFamilyForBusiness(facts),
      name: facts.name,
      city: facts.city,
      state: facts.state,
      category: facts.category,
      source: {
        input,
        // Structured intake bypasses forgePacket's prompt parser, which trips on
        // names like "Howie Excavating & Grading" (G1, E8). Same contract the
        // ghost-agency build-preview endpoint uses.
        intake: {
          businessName: facts.name,
          industry: facts.category,
          city: facts.city,
          state: facts.state,
          phone: facts.phone || undefined,
          currentWebsite: facts.website || undefined,
          services: (facts.services || []).join(", ") || undefined,
        },
        facts,
        evidence,
        discovery,
        assets: sourceAssets,
        files: [...preparedFiles.files, ...(discovery?.files || [])].slice(0, 7),
      },
    });
    let result = null;
    if (options.awaitPreview) {
      result = await done;
    } else if (Engine.SERVERLESS && typeof globalThis.__siteforgeWaitUntil === "function" && !job.staged) {
      globalThis.__siteforgeWaitUntil(done.finally(() => DB.flushRemote()));
    }
    const jobState = DB.get("jobs", job.id);
    preview = {
      job_id: job.id,
      correlation_id: job.correlation_id || job.id,
      status: result ? "complete" : jobState?.status === "failed" ? "failed" : "queued",
      url: result?.preview || "",
      error: result ? "" : String(jobState?.error || ""),
      qc: result?.qc || {},
    };
  }

  const packet = buildCanonicalPacket({
    input,
    facts,
    discovery,
    evidence,
    assets: sourceAssets,
    trust: cached?.trust || {},
    optimization: cached?.optimization || {},
    preview,
    cache,
    warnings: [cached ? "cache_hit" : "", preparedFiles.ignored.length ? `ignored_files:${preparedFiles.ignored.join(",")}` : ""].filter(Boolean),
  });
  if (preview.status === "failed") {
    packet.ok = false;
    packet.status = "blocked";
    packet.error = `Preview build failed QC: ${preview.error || "quality gate did not pass"}`;
  }
  const validation = validateCanonicalPacket(packet);
  if (!validation.ok) return { ok: false, version: VERSION, status: "blocked", error: `Canonical packet validation failed: ${validation.errors.join(", ")}`, packet };
  const cacheableDiscovery = discovery ? {
    ...discovery,
    assets: sourceAssets,
    found: {
      ...(discovery.found || {}),
      photos: sourceAssets.filter((asset) => asset.kind === "photo").map((asset) => asset.url),
      videos: sourceAssets.filter((asset) => asset.kind === "video").map((asset) => asset.url),
      socials: facts.socials || [],
    },
    files: [],
  } : discovery;
  if (cacheHasSourceEvidence({ assets: packet.assets, discovery: cacheableDiscovery }, input)) {
    writeCache(key, { evidence: packet.evidence, assets: packet.assets, trust: packet.trust, optimization: packet.optimization, discovery: cacheableDiscovery });
  }
  return packet;
}

function cacheHasSourceEvidence(cached, input) {
  if (!cached) return false;
  if (!input?.sources?.website_url && !input?.sources?.gbp_url && !input?.sources?.asset_url) return true;
  const assets = Array.isArray(cached.assets) ? cached.assets : [];
  const found = cached.discovery?.found || {};
  const pagesRead = Number(cached.discovery?.summary?.pages_read || 0);
  const hasMedia = assets.some((asset) => ["logo", "photo", "video"].includes(asset?.kind) && asset?.url)
    || Boolean(found.logo || found.photos?.length || found.videos?.length);
  const hasBusinessFacts = Boolean(found.copy || found.services?.length || cached.discovery?.facts?.services?.length);
  return pagesRead > 0 && (hasMedia || hasBusinessFacts);
}

export async function compileMachineRequest(req, body) {
  const idem = String(req.headers["idempotency-key"] || body.request_id || "").trim();
  if (!idem) return { ok: false, status: 400, error: "Idempotency-Key is required." };
  if (IDEMPOTENCY.has(idem)) return IDEMPOTENCY.get(idem);
  const result = await compileFromInput(body, { awaitPreview: Engine.SERVERLESS, trustedBrandReview: body.brand_review });
  IDEMPOTENCY.set(idem, result);
  return result;
}
