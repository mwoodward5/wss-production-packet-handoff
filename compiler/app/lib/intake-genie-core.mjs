import { observedCopy, sourceSections, safeVisitorMarkdown } from "../../factory/lib/source-copy.mjs";
import { createHash } from "node:crypto";
import { sourceFieldsFromPrompt } from "./source-intake.mjs";
import { buildRemixPacket } from "./remix-packet.mjs";

export const VERSION = "intake-genie-v2";
// v7 invalidates packets that admitted prefixed gallery/portfolio section labels.
// v6 invalidates packets where raw discovery restored rejected service headings.
// v5 invalidates evidence cached before document-title service extraction was removed.
// Earlier versions invalidate evidence cached before service-heading refusal
// rules. Reusing older rows can reintroduce facts the current extractor now
// correctly refuses.
// v8 carries source-scoped rich visitor copy and current service-heading admission.
// v14 binds distinct same-page depth excerpts verified in source snapshots.
// v13 binds distinct same-page service name and description excerpts.
// v12 preserves a corroborated operator business name over an SEO page title.
// v11 re-extracts prose past media and call-to-action lines within a service section.
const CACHE_SCHEMA = "intake-genie-cache-v14";

export const SUPPORTED_CATEGORIES = [
  // High-value owner-priority verticals (solo, image-driven, website-dependent)
  "tattoo studio",
  "med spa",
  "dental",
  "photographer",
  "piercing",
  "attorney",
  "massage",
  "hair salon",
  "barber",
  "nail studio",
  "wedding vendor",
  "auto detailing",
  "ceramic coating",
  // Home-service trades
  "roofing",
  "plumbing",
  "hvac",
  "pool service",
  "landscaping",
  "electrical",
  "concrete",
  "fencing",
  "painting",
  "cleaning",
  "solar",
  "pest control",
  "tree care",
  "excavation",
  "general contracting",
  "garage door",
];

const CATEGORY_PATTERNS = [
  // High-value verticals first so their tokens win before generic trade tokens
  // (critically, "med spa" must match here before the pool-service "spa" below).
  ["med spa", /\bmed(?:ical)?\s*spa\b|\bmedspa\b|\bbotox\b|\bdysport\b|\bfiller\b|\baesthetics?\b|\binjectable|\bmicroneedl|\bdermal|\bskin\s*(?:care|clinic)|\blip\s*filler|\bhydrafacial/i],
  ["dental", /\bdentist|\bdental\b|\borthodont|\bveneers?\b|\bdental\s+implant|\binvisalign|\bteeth\s+whiten|\bcosmetic\s+dent|\bDDS\b|\bDMD\b/i],
  ["attorney", /\battorney|\blawyer|\blaw\s+(?:firm|office|group)\b|\blegal\s+services|\blitigat|\bcounsel\s+at\s+law/i],
  ["photographer", /\bphotograph(?:y|er|ers)?\b|\bphoto\s+studio|\bportrait\b|\bwedding\s+photo/i],
  ["piercing", /\bpiercing|\bpiercer\b|\bbody\s+piercing/i],
  ["massage", /\bmassage|\bmasseuse|\bmasseur|\bbodywork|\bdeep\s+tissue|\bmyofascial/i],
  ["hair salon", /\bhair\s+salon|\bhairstylist|\bhair\s+stylist|\bblowout\b|\bhair\s+studio|\bhair\s+bar/i],
  ["barber", /\bbarber\b|\bbarbershop|\bbarber\s+shop|\bmen'?s\s+grooming/i],
  ["nail studio", /\bnail\s+(?:salon|studio|bar|spa)\b|\bmanicure|\bpedicure/i],
  ["wedding vendor", /\bwedding\b|\bbridal\b|\bflorist|\bwedding\s+planner|\bevent\s+planner/i],
  ["auto detailing", /\bauto detail|\bcar detail|\bmobile detail|\bdetailing\b|\bauto spa|\bcar spa|\bcar wash|ceramic coat|paint correction/i],
  ["tattoo studio", /\btattoos?\b|\btattoo(?:ed|ing|er)\b|\btattoo\s+(?:artist|studio|shop|parlour|parlor)\b|\bbody\s+art\b/i],
  ["roofing", /\broof|shingle|gutter/i],
  ["hvac", /\bhvac|heating|air condition|furnace|heat pump/i],
  ["pool service", /\bpool|spa|hot tub/i],
  ["landscaping", /\blandscap|lawn|hardscape|irrigation|paver|outdoor kitchen/i],
  ["plumbing", /\bplumb|drain|water heater|pipe\b/i],
  ["electrical", /\belectric|breaker|panel|wiring/i],
  ["concrete", /\bconcrete|driveway|slab|stamped/i],
  ["fencing", /\bfence|fencing/i],
  ["painting", /\bpaint|painter|coating/i],
  ["cleaning", /\bcleaning|maid|janitorial|pressure wash/i],
  ["solar", /\bsolar|panel|photovoltaic/i],
  ["pest control", /\bpest|termite|rodent|extermin/i],
  ["tree care", /\btree|arborist|stump/i],
  ["excavation", /\bexcavat|grading|trenching|earthwork/i],
  ["general contracting", /\bcontractor|remodel|renovation|builder|construction/i],
  ["garage door", /\bgarage door|overhead door/i],
];

const HOST_CATEGORY_PATTERNS = [
  ["med spa", /medspa|medicalspa|aesthetic|botox|skincare|dermat|injectable|hydrafacial/],
  ["dental", /dental|dentist|dds|dmd|orthodont|veneer|smile|invisalign/],
  ["attorney", /lawfirm|lawoffice|attorney|lawyer|legal(?!ly)|counsel|litigat/],
  ["photographer", /photograph|photostudio|portrait|photography/],
  ["piercing", /piercing|bodypiercing/],
  ["massage", /massage|bodywork|deeptissue/],
  ["hair salon", /hairsalon|hairstudio|hairstylist|blowout/],
  ["barber", /barber|barbershop/],
  ["nail studio", /nailsalon|nailstudio|nailbar|manicure/],
  ["wedding vendor", /wedding|bridal|florist/],
  ["auto detailing", /autodetail|cardetail|mobiledetail/],
  ["tattoo studio", /tattoo(?:artist|studio|shop|parlour|parlor|ing|er|s)?|bodyart(?:studio)?(?!ist)/],
  ["roofing", /roof|shingle|gutter/],
  ["hvac", /hvac|heating|aircondition|furnace|heatpump/],
  ["pool service", /pool|spa|hottub/],
  ["landscaping", /landscap|lawn|hardscape|irrigation|paver/],
  ["plumbing", /plumb|drain|waterheater/],
  ["electrical", /electric|breaker|wiring/],
  ["concrete", /concrete|driveway|stamped/],
  ["fencing", /fence|fencing/],
  ["painting", /paint|coating/],
  ["cleaning", /cleaning|maid|janitorial|pressurewash/],
  ["solar", /solar|photovoltaic/],
  ["pest control", /pest|termite|rodent|extermin/],
  ["tree care", /arborist|stump|treecare/],
  ["excavation", /excavat|grading|trenching|earthwork/],
  ["general contracting", /contractor|remodel|renovation|construction/],
  ["garage door", /garagedoor|overheaddoor/],
];

const OUT_OF_SCOPE = [
  ["dental practice", /\bdentist|dental|orthodont/i],
  ["restaurant", /\brestaurant|cafe|coffee|bar\b|bakery|pizza|taco|food truck/i],
  ["law firm", /\blaw firm|attorney|lawyer|legal\b/i],
  ["medical clinic", /\bmedical|clinic|urgent care|doctor|physician|chiropr/i],
  ["real estate office", /\breal estate|realtor|brokerage|mortgage/i],
  ["insurance or accounting firm", /\binsurance|accounting|bookkeeping|tax prep|cpa\b/i],
  ["salon", /\bsalon|barber|nail|lashes|beauty/i],
  ["automotive dealership", /\bauto dealer|car dealer|dealership|used cars/i],
  ["retail or ecommerce store", /\becommerce|shopify|retail store|boutique/i],
  ["software or marketing agency", /\bsoftware|marketing agency|seo agency|app development/i],
];

export function normalizeUrl(value, { allowPrivate = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    const err = new Error(`Invalid URL: ${raw}`);
    err.status = 400;
    throw err;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const err = new Error("Only http and https URLs are supported.");
    err.status = 400;
    throw err;
  }
  const host = parsed.hostname.toLowerCase();
  if (!allowPrivate && isPrivateHost(host)) {
    const err = new Error("Private-network URLs are not accepted for public intake.");
    err.status = 400;
    throw err;
  }
  parsed.hostname = host;
  parsed.hash = "";
  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
  return parsed.toString();
}

function isPrivateHost(host) {
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\.|^10\.|^0\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === "::1" || host.startsWith("[::1]")) return true;
  return false;
}

export function normalizeInput(input = {}, { allowPrivate = false } = {}) {
  const description = clean(input.description || input.prompt || input.text, 12000);
  const promptSources = sourceFieldsFromPrompt(description);
  const labeledWebsite = description.match(/\bwebsite\s*(?::|is)\s*((?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?)/i)?.[1]?.replace(/[.,;!?]+$/, "") || "";
  const nestedSources = input.sources || {};
  const sources = {
    website_url: normalizeOptionalUrl(input.website_url || input.website || input.currentWebsite || nestedSources.website_url || promptSources.website_url || labeledWebsite, { allowPrivate }),
    gbp_url: normalizeOptionalUrl(input.gbp_url || input.google_url || input.maps_url || input.gbpLink || nestedSources.gbp_url || promptSources.gbp_url, { allowPrivate }),
    social_url: normalizeOptionalUrl(input.social_url || input.facebook_url || input.instagram_url || nestedSources.social_url || promptSources.social_url, { allowPrivate }),
    asset_url: normalizeOptionalUrl(input.asset_url || input.assets_url || input.drive_url || nestedSources.asset_url || promptSources.asset_url, { allowPrivate }),
  };
  const hints = input.prospect_hints || input.hints || {};
  const labeledPhone = labeledValue(description, "phone", 32);
  const labeledAddress = labeledValue(description, "address", 180);
  const services = normalizeServiceHints(hints.services || input.services || labeledValue(description, "services?", 500));
  const rawRequirements = input.requirements || input.build_requirements || {};
  const rawBrandReview = input.brand_review || input.brand || {};
  return {
    request_id: clean(input.request_id || input.requestId, 160),
    mode: clean(input.mode, 24) || "full",
    build_preview: input.build_preview !== false,
    dry_run: input.dry_run !== false && input.dryRun !== false,
    sources,
    description,
    latlng: Number.isFinite(Number(input.latlng?.lat)) && Number.isFinite(Number(input.latlng?.lng))
      ? { lat: Number(input.latlng.lat), lng: Number(input.latlng.lng) }
      : null,
    prospect_hints: {
      name: clean(hints.name || input.name || input.business_name || input.businessName, 120),
      city: clean(hints.city || input.city, 80),
      state: clean(hints.state || input.state, 2).toUpperCase(),
      category: normalizeCategory(hints.category || input.category || input.industry),
      phone: normalizePhoneHint(hints.phone || input.phone || labeledPhone),
      address: clean(hints.address || input.address || labeledAddress, 180),
      services,
    },
    requirements: {
      site_type: clean(rawRequirements.site_type || input.site_type, 80),
      template_id: clean(rawRequirements.template_id || rawRequirements.template || input.template_id, 120),
      execution_mode: clean(rawRequirements.execution_mode || input.execution_mode, 40),
      page_plan: normalizeStringList(rawRequirements.page_plan || input.page_plan, 24, 120),
      must_include: normalizeStringList(rawRequirements.must_include || input.must_include, 24, 240),
      must_avoid: normalizeStringList(rawRequirements.must_avoid || input.must_avoid, 24, 240),
      notes: clean(rawRequirements.notes || input.requirements_notes, 2000),
      settings: normalizeSettings(rawRequirements.settings),
    },
    brand_review: {
      logo_url: normalizeOptionalUrl(rawBrandReview.logo_url || input.logo_url, { allowPrivate }),
      colors: normalizeStringList(rawBrandReview.colors || input.brand_colors, 12, 32),
      fonts: normalizeStringList(rawBrandReview.fonts || input.brand_fonts, 8, 80),
      verification_source: clean(rawBrandReview.verification_source || input.brand_verification_source, 40),
      requested_verified: rawBrandReview.verified === true || input.brand_verified === true,
      verified: false,
      trusted_context: false,
    },
  };
}

function normalizePhoneHint(value = "") {
  const phone = clean(value, 32);
  return /\b\d{3}\D*555\D*01\d{2}\b/.test(phone) ? "" : phone;
}

function normalizeOptionalUrl(value, options) {
  return value ? normalizeUrl(value, options) : "";
}

function clean(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function labeledValue(text = "", label = "", max = 300) {
  const match = String(text).match(new RegExp(`\\b(?:verified\\s+)?${label}\\s*(?::|\\bis\\b|\\binclude(?:s)?\\b|\\bare\\b)\\s*([^.;\\n]+)`, "i"));
  return clean(String(match?.[1] || "").split(/\s+and\s+(?:our|my|the)\s+(?:website|phone|address|email)\b/i)[0], max);
}

function normalizeServiceHints(value) {
  const rows = Array.isArray(value) ? value : String(value || "").split(/,|;|\band\b/i);
  return [...new Set(rows.map((item) => clean(item, 60).replace(/^(?:and|or)\s+/i, "")).filter((item) => item.length >= 3))].slice(0, 10);
}

function normalizeStringList(value, limit, max) {
  const rows = Array.isArray(value) ? value : String(value || "").split(/[,;\n]/);
  return [...new Set(rows.map((item) => clean(item, max)).filter(Boolean))].slice(0, limit);
}

function normalizeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => {
    const safeKey = clean(key, 80);
    if (Array.isArray(item)) return [safeKey, normalizeStringList(item, 30, 240)];
    if (typeof item === "boolean" || Number.isFinite(item)) return [safeKey, item];
    return [safeKey, clean(item, 500)];
  }).filter(([key]) => key));
}

export function normalizeCategory(value = "") {
  const text = String(value || "").toLowerCase();
  // Ghost's donor registry uses the short vertical label "salon" for the
  // Lacquer Studio family; keep the compiler's canonical category explicit so
  // it reaches the existing hair-salon defaults and scope rules.
  if (/^\s*salon\s*$/.test(text)) return "hair salon";
  for (const [category, pattern] of CATEGORY_PATTERNS) if (pattern.test(text)) return category;
  return "";
}

export function detectScope(input = {}) {
  const text = [
    input.description,
    input.prospect_hints?.category,
    input.prospect_hints?.name,
    input.sources?.website_url,
    input.sources?.gbp_url,
    input.sources?.social_url,
  ].filter(Boolean).join(" ");
  for (const [label, pattern] of OUT_OF_SCOPE) {
    if (pattern.test(text) && !CATEGORY_PATTERNS.some(([, catPattern]) => catPattern.test(text))) {
      return {
        supported: false,
        category: "",
        message: `Woodward Software Labs Intake Genie currently specializes in home-service trades: ${SUPPORTED_CATEGORIES.join(", ")}. This looks like a ${label}, so we won't force it through the wrong engine.`,
      };
    }
  }
  const category = input.prospect_hints?.category || normalizeCategory(text) || categoryFromSourceHost(input);
  return { supported: Boolean(category), category, message: "" };
}

function categoryFromSourceHost(input = {}) {
  const hosts = [input.sources?.website_url, input.sources?.social_url]
    .filter(Boolean)
    .map((value) => {
      try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
    });
  const compact = hosts.join("").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!compact) return "";
  for (const [category, pattern] of HOST_CATEGORY_PATTERNS) if (pattern.test(compact)) return category;
  return "";
}

export function shouldDiscoverBeforeScope(input = {}, scope = detectScope(input)) {
  const hasPublicBusinessSource = Boolean(input.sources?.website_url || input.sources?.gbp_url);
  return !scope.supported && !scope.message && hasPublicBusinessSource;
}

export function deriveFacts(input = {}) {
  const hints = input.prospect_hints || {};
  const text = `${hints.name || ""} ${input.description || ""} ${input.sources?.website_url || ""}`;
  const inferred = inferFromText(text);
  const scope = detectScope(input);
  // Identity provenance (owner law 2026-09-19): an operator-typed hint is an
  // EXPLICIT claim; a name inferred from freeform prose is WEAK evidence that
  // a corroborating source identity must be allowed to override. The merge
  // law itself lives in factsFromDiscovery.
  const nameSource = clean(hints.name, 90) ? "hint"
    : inferred.name ? "inferred"
      : input.sources?.website_url ? "domain"
        : "";
  const facts = {
    name: hints.name || inferred.name || domainName(input.sources?.website_url) || "",
    name_source: nameSource,
    city: hints.city || inferred.city || "",
    state: hints.state || inferred.state || "",
    category: scope.category || hints.category || inferred.category || "",
    website: input.sources?.website_url || "",
    socials: input.sources?.social_url ? [input.sources.social_url] : [],
    latlng: input.latlng || null,
    phone: hints.phone || "",
    address: hints.address || "",
    services: Array.isArray(hints.services) ? hints.services : [],
  };
  const missing = [];
  if (!facts.name) missing.push("name");
  if (!facts.city || !facts.state) missing.push("location");
  if (!facts.category) missing.push("trade");
  return { facts, missing, scope };
}

function inferFromText(text) {
  const t = String(text || "").trim();
  // A bare two-letter token can be a country or a button label ("Contact US").
  // Admit only actual state codes, then let owned-source locality evidence
  // resolve ambiguous freeform copy in factsFromDiscovery.
  const stateCodes = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));
  const stateMatch = (t.match(/\b[A-Z]{2}\b/g) || []).filter((code) => stateCodes.has(code));
  const state = stateMatch.at(-1) || "";
  let city = "";
  const namedBusiness = t.match(/\b(?:my\s+)?business\s+is\s+called\s+([^.!?]{2,90})/i);
  let m = t.match(/\bin\s+([A-Z][A-Za-z .'-]{1,40}?)(?:\s+and\b|,?\s+[A-Z]{2}\b)/);
  if (!m) m = t.match(/\bin\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s*,?\s+[A-Z]{2}\b/);
  if (!m) m = t.match(/([A-Za-z][A-Za-z .'-]{1,40}?)\s*,\s+[A-Z]{2}\b/);
  if (m) city = clean(m[1], 80);
  const category = normalizeCategory(t);
  const beforeLocation = m?.index > 0 ? t.slice(0, m.index).trim() : t;
  let name = clean(namedBusiness?.[1] || beforeLocation.split(/[,\-|]|[—–]/)[0], 90).replace(/^(the|a|an)\s+/i, "");
  // Freeform prompts are requests, not identities: "Create a private preview
  // for <site>" surfaced "a private preview for ..." as the business name (owner
  // defect 2026-09-19). Strip a leading imperative request phrase, drop any
  // embedded URL, and only then treat the remainder as a candidate name.
  name = name.replace(
    /^(?:please\s+)?(?:build|create|make|forge|design|generate)(?:\s+me)?(?:\s+(?:a|an|one))?(?:\s+(?:private|premium|quick|free|new))?(?:\s+(?:website|site|page|landing|preview))?(?:\s+(?:page|site|preview))?\s+(?:for|of)\s+/i,
    "",
  );
  name = name.replace(/https?:\/\/\S+/gi, "").trim();
  name = name.replace(/^(?:for|at)\s+/i, "").trim();
  name = name.replace(/\s+(?:in|serving)\s+[A-Z][A-Za-z .'-]{1,40}$/i, "").trim();
  name = stripTrailingTrade(name, category);
  if (/^https?:\/\//i.test(name) || name.length < 2) name = "";
  return { name, city, state, category };
}

function domainName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

function stripTrailingTrade(name, category) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 3 || !category) return name;
  const patterns = {
    "pool service": /\bpool service$/i,
    landscaping: /\blandscaping$/i,
    concrete: /\bconcrete$/i,
    fencing: /\bfencing$/i,
    painting: /\bpainting$/i,
    cleaning: /\bcleaning$/i,
    "pest control": /\bpest control$/i,
    "tree care": /\btree care$/i,
    excavation: /\bexcavation$/i,
    "general contracting": /\bgeneral contracting$/i,
    "garage door": /\bgarage doors?$/i,
  };
  const pattern = patterns[category];
  return pattern ? clean(name.replace(pattern, ""), 90) || name : name;
}

export function missingFactResponse(missing = []) {
  const fact = missing[0];
  const questions = {
    name: ["What is the business name?", "Cedar Stone Hardscapes"],
    location: ["What city and two-letter state does this business serve?", "Plano, TX"],
    trade: ["What home-service trade should this be built for?", "Roofing"],
  };
  const [question, placeholder] = questions[fact] || questions.name;
  return { needs_input: true, missing_fact: fact, question, placeholder };
}

export function cacheKeyFor(input = {}) {
  const normalized = JSON.stringify({
    version: VERSION,
    cache_schema: CACHE_SCHEMA,
    sources: input.sources || {},
    description: input.description || "",
    prospect_hints: input.prospect_hints || {},
    requirements: input.requirements || {},
    brand_review: input.brand_review || {},
  });
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

// Aggregate extracted fields can certify this business only when every crawl
// observation belongs to its submitted source scope. A shared-host sibling is
// another business, and a submitted URL alone is not an observed source.
export function sourceDiscoveryIsBound(input = {}, discovery = {}) {
  if (!discovery || typeof discovery !== "object" || discovery.stale === true
      || !Array.isArray(discovery.sources) || !discovery.sources.length) return false;
  try {
    const base = new URL(input.sources?.website_url || "");
    if (!/^https?:$/.test(base.protocol) || base.username || base.password) return false;
    const prefix = base.pathname.replace(/\/+$/, "") || "/";
    const owned = (value) => {
      if (typeof value !== "string") return false;
      const url = new URL(value);
      return !url.username && !url.password && url.origin === base.origin
        && (prefix === "/" || url.pathname === prefix || url.pathname.startsWith(prefix + "/"));
    };
    return discovery.sources.every(owned)
      && (!discovery.facts?.website || owned(discovery.facts.website));
  } catch {
    return false;
  }
}

export function buildCanonicalPacket({ input, facts, discovery = {}, evidence = [], assets = [], trust = {}, optimization = {}, preview = {}, cache = {}, warnings = [] }) {
  const effectiveDiscovery = freshObject(discovery) && Object.keys(discovery).length
    ? discovery
    : facts.discovery;
  // Source intake can report an SEO document title as the business name. Keep
  // an explicit operator name only when the owned source title itself names it
  // in the brand segment; genuine identity conflicts remain untouched.
  const hintedName = String(input?.prospect_hints?.name || "").trim();
  const sourceTitle = String(effectiveDiscovery?.facts?.name || facts.name || "").trim();
  const brandSegment = sourceTitle.split(/\s+[|—–]\s+|\s+-\s+/).at(-1) || "";
  const nameToken = hintedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (hintedName.split(/\s+/).length >= 2 && nameToken
      && !facts.name_conflict && sourceDiscoveryIsBound(input, effectiveDiscovery)
      && new RegExp(`(?:^|\\W)${nameToken}(?:$|\\W)`, "i").test(brandSegment)) {
    facts = { ...facts, name: hintedName, name_source: "hint" };
  }
  const richFacts = canonicalRichFacts({ ...facts, discovery: effectiveDiscovery }, input, assets);
  const remixPacket = buildRemixPacket({
    input,
    facts,
    discovery: effectiveDiscovery,
    evidence,
    assets,
    warnings,
    renderedVerification: preview.rendered_verification,
  });

  // ---- ghost line-genie-certified-v7 contract emission ---------------------
  // The ghost caller certifies only packets that name their request, carry a
  // stable job identity, bind every published service to the official source
  // text (or honestly label category defaults as estimates), and ship a
  // CertifiedPracticePacket/v1 content contract whose visitor copy is plain
  // hashed Markdown derived from these same facts. Everything below is derived
  // from the packet's own evidence — nothing is asserted that the source text
  // does not contain.
  const requestId = clean(input.request_id, 160);
  const jobId = String(preview.job_id || "").trim()
    || (requestId
      ? `job-${createHash("sha256").update(requestId).digest("hex").slice(0, 16)}`
      : `job-${cacheKeyFor(input).replace(/[^a-z0-9_-]/gi, "").slice(0, 24)}`);

  const discoveryText = [
    effectiveDiscovery?.found?.copy || "",
    (effectiveDiscovery?.found?.services || []).join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
  const discoveryIsBound = sourceDiscoveryIsBound(input, effectiveDiscovery);
  const discoveredPages = (discoveryIsBound && Array.isArray(effectiveDiscovery?.sources)
    ? effectiveDiscovery.sources
    : []).filter((url) => /^https?:\/\//i.test(String(url || "")));
  const claimed = [...new Set([
    // facts.services has already passed service-label admission. Raw discovery
    // can corroborate those labels, but must not restore rejected headings.
    ...(facts.services || []).map((service) => String(service || "").trim()),
  ])].filter(Boolean);
  const inSourceText = (service) => {
    const needle = String(service).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    return Boolean(needle) && discoveryText.includes(needle);
  };
  // found.services must come from the owned crawl scope; other
  // claimed services are admitted only when the source text literally contains
  // them. Everything else falls back to honestly-labeled category defaults.
  const sourceBoundServices = discoveryIsBound ? claimed.filter((service) =>
    (Array.isArray(effectiveDiscovery?.found?.services)
      && effectiveDiscovery.found.services.map((s) => String(s || "").trim()).includes(service))
    || inSourceText(service)) : [];
  const serviceObservations = new Map();
  for (const row of Array.isArray(effectiveDiscovery?.found?.service_observations)
    ? effectiveDiscovery.found.service_observations : []) {
    const name = String(row?.name || "").trim();
    const sourceUrl = String(row?.source_url || "");
    const excerpt = String(row?.excerpt || row?.evidence || "").trim();
    const nameExcerpt = String(row?.name_excerpt || excerpt).trim();
    const description = String(row?.description || "").trim();
    const descriptionExcerpt = String(row?.description_excerpt || excerpt).trim();
    if (!discoveryIsBound || !discoveredPages.includes(sourceUrl)
      || !name || !nameExcerpt || nameExcerpt.length > 1800
      || !nameExcerpt.toLowerCase().includes(name.toLowerCase())
      || !safeVisitorMarkdown(nameExcerpt)) continue;
    if (!serviceObservations.has(name)) serviceObservations.set(name, {
      sourceUrl, excerpt: nameExcerpt, descriptionExcerpt,
      description: description.length >= 20 && description.length <= 700
        && descriptionExcerpt.length <= 1800 && descriptionExcerpt.includes(description)
        && safeVisitorMarkdown(descriptionExcerpt) ? description : "",
    });
  }
  // A single observed page retains its exact page URL even for older crawl
  // rows that predate per-page observations. Multi-page aggregates must supply
  // the page mapping so a service is never attributed to the wrong page.
  if (discoveredPages.length === 1 && typeof effectiveDiscovery?.found?.copy === "string") {
    for (const name of sourceBoundServices) {
      if (serviceObservations.has(name)) continue;
      const copy = effectiveDiscovery.found.copy;
      const at = copy.toLowerCase().indexOf(name.toLowerCase());
      if (at < 0) continue;
      const line = copy.slice(copy.lastIndexOf("\n", at) + 1, copy.indexOf("\n", at) < 0 ? undefined : copy.indexOf("\n", at)).trim();
      if (line && line.length <= 1800 && line.toLowerCase().includes(name.toLowerCase()) && safeVisitorMarkdown(line))
        serviceObservations.set(name, { sourceUrl: discoveredPages[0], excerpt: line });
    }
  }
  const certifiedServices = sourceBoundServices.filter((service) => serviceObservations.get(service)?.description);
  const servicesAreSourceBound = certifiedServices.length > 0;
  const packetServices = servicesAreSourceBound ? certifiedServices : boundedServices(facts);
  const servicesSource = servicesAreSourceBound ? "source_bound" : "category default";

  const serviceEvidence = servicesAreSourceBound
    ? packetServices.map((service) => ({
      field: "services",
      value: service,
      source_type: "source",
      provenance: "observed",
      verification_status: "source observation",
      source_url: serviceObservations.get(service).sourceUrl,
      source_observations: [serviceObservations.get(service).sourceUrl],
      excerpt: serviceObservations.get(service).excerpt,
      description_excerpt: serviceObservations.get(service).descriptionExcerpt,
      verified: true,
      status: "verified",
      observed_at: new Date().toISOString(),
    }))
    : packetServices.map((service) => ({
      field: "services",
      value: service,
      source_type: "category default",
      provenance: "estimated",
      verification_status: "estimated",
    }));

  const contractFiles = {
    "content/home.md": [
      `# ${facts.name || "The business"}`,
      "",
      `${facts.name || "The business"} offers ${packetServices.join(", ") || facts.category || "professional services"}`
        + ` in ${[facts.city, facts.state].filter(Boolean).join(", ") || "its service area"}.`,
      "",
    ].join("\n"),
  };
  // Copy is projected only from the observed crawl of this exact source scope.
  // Unverified input.copy and unrelated/sibling source pages are never promoted.
  const sourceCopy = servicesAreSourceBound
    ? sourceSections(observedCopy(effectiveDiscovery, input.sources?.website_url || facts.website || ""), packetServices)
    : { about: [], services: {}, faqs: [] };
  if (sourceCopy.about.length) {
    const about = sourceCopy.about.join("\n\n");
    contractFiles["content/about.md"] = "# About\n\n" + about + "\n";
    // The existing Ghost adapter prioritizes home prose. Keep the observed copy there too.
    contractFiles["content/home.md"] = contractFiles["content/home.md"].replace("\n\n", "\n\n" + about + "\n\n");
  }
  for (const name of certifiedServices) {
    const paragraph = serviceObservations.get(name)?.description;
    if (!paragraph) continue;
    const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) continue;
    let file = "content/services/" + slug + ".md";
    if (Object.hasOwn(contractFiles, file)) file = "content/services/" + slug + "-" + createHash("sha256").update(name).digest("hex").slice(0, 8) + ".md";
    contractFiles[file] = "# " + name + "\n\n" + paragraph + "\n";
  }
  if (sourceCopy.faqs.length) contractFiles["content/faq.md"] = "# Frequently Asked Questions\n\n" + sourceCopy.faqs.map(({ q, a }) => "## " + q + "\n\n" + a).join("\n\n") + "\n";
  const sourcePages = new Set(discoveredPages);
  const safeDepthText = (value) => {
    const text = String(value || "").trim();
    return text && text.length <= 500 && safeVisitorMarkdown(text) ? text : "";
  };
  const admittedDepth = {};
  const depthEvidence = [];
  const sourceDepth = discoveryIsBound ? effectiveDiscovery?.found?.depth_channels || {} : {};
  for (const channel of ["reviews", "hours", "faqs", "areas"]) {
    const rows = [];
    for (const entry of Array.isArray(sourceDepth[channel]) ? sourceDepth[channel] : []) {
      const sourceUrl = String(entry?.source_url || "");
      const excerpt = String(entry?.evidence || "");
      if (!sourcePages.has(sourceUrl) || !excerpt.trim()) continue;
      const fields = channel === "reviews" ? ["quote", "author"]
        : channel === "faqs" ? ["question", "answer"] : ["value"];
      const values = Object.fromEntries(fields.map((field) => [field, safeDepthText(entry[field])]));
      const fragments = Object.fromEntries(fields.map((field) => [field,
        String(entry[`${field}_excerpt`] || excerpt).trim()]));
      if (fields.some((field) => !values[field] || !fragments[field].includes(values[field])
        || fragments[field].length > 1800 || !safeVisitorMarkdown(fragments[field]))) continue;
      rows.push({ ...values, source_url: sourceUrl, evidence: excerpt,
        evidence_fragments: fragments });
      depthEvidence.push({
        field: channel,
        value: values.value || values.quote || values.question,
        source_type: "source", provenance: "observed",
        verification_status: "source observation", source_url: sourceUrl,
        source_observations: [sourceUrl], excerpt,
        evidence_fragments: fragments, verified: true, status: "verified",
      });
      if (rows.length >= 12) break;
    }
    if (rows.length) admittedDepth[channel] = rows;
  }
  if (admittedDepth.reviews) contractFiles["content/reviews.md"] = [
    "# Reviews", "",
    ...admittedDepth.reviews.flatMap(({ quote, author }) => [`> ${quote}`, `— ${author}`, ""]),
  ].join("\n");
  if (admittedDepth.hours) contractFiles["content/hours.md"] = [
    "# Hours", "", ...admittedDepth.hours.map(({ value }) => `- ${value}`), "",
  ].join("\n");
  if (admittedDepth.faqs) contractFiles["content/faq.md"] = [
    "# Frequently Asked Questions", "",
    ...admittedDepth.faqs.flatMap(({ question, answer }) => [`## ${question}`, answer, ""]),
  ].join("\n");
  if (admittedDepth.areas) contractFiles["content/service-areas.md"] = [
    "# Service Areas", "", ...admittedDepth.areas.map(({ value }) => `- ${value}`), "",
  ].join("\n");
  const certifiedDiscovery = Object.keys(admittedDepth).length || richFacts.discovery?.found?.depth_channels
    ? { ...richFacts.discovery, found: { ...(richFacts.discovery?.found || {}), depth_channels: admittedDepth } }
    : richFacts.discovery;
  const copyViolations = Object.entries(contractFiles).filter(([, body]) => !safeVisitorMarkdown(body)).map(([file]) => "unsafe_visitor_copy:" + file);
  const contentContract = {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    facts: { category: facts.category },
    assets: {},
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      files: contractFiles,
      file_hashes: Object.fromEntries(Object.entries(contractFiles).map(([file, body]) => [
        file,
        createHash("sha256").update(body).digest("hex"),
      ])),
      // Scan the actual emitted bytes, including observed source paragraphs.
      safety: { pass: copyViolations.length === 0, violations: copyViolations },
    },
  };

  return {
    ok: true,
    version: VERSION,
    job_id: jobId,
    request_id: requestId,
    status: preview.status || "complete",
    scope: {
      supported: true,
      category: facts.category,
      message: "",
    },
    sources: servicesAreSourceBound
      ? {
        observations: discoveredPages.slice(0, 5).map((page) => ({
          source: page,
          extracted: { exactServices: packetServices.filter((service) => serviceObservations.get(service)?.sourceUrl === page) },
        })),
      }
      : {},
    content: { content_contract: contentContract },
    facts: {
      name: facts.name,
      city: facts.city,
      state: facts.state,
      category: facts.category,
      phone: facts.phone || "",
      email: facts.email || "",
      website: facts.website || input.sources?.website_url || "",
      address: facts.address || "",
      latlng: facts.latlng || null,
      hours: facts.hours || null,
      booking_url: facts.booking_url || null,
      services: packetServices,
      services_source: servicesSource,
      socials: facts.socials || [],
      // Keep the source-backed material that V8/Fable uses to make a site sound
      // like the actual business. These are additive optional fields, so older
      // packet consumers can continue reading the established fact contract.
      copy: richFacts.copy,
      testimonials: richFacts.testimonials,
      founded: richFacts.founded,
      discovery: certifiedDiscovery,
      branding: richFacts.branding,
    },
    discovery: certifiedDiscovery,
    branding: richFacts.branding,
    evidence: [...evidence, ...serviceEvidence, ...depthEvidence],
    assets,
    trust: {
      rating: trust.rating ?? null,
      review_count: trust.review_count ?? null,
      reviews: Array.isArray(trust.reviews) ? trust.reviews.slice(0, 3) : [],
    },
    optimization: {
      seo_gaps: optimization.seo_gaps || ["local schema", "service proof", "answer-engine FAQ"],
      target_queries: (optimization.target_queries || targetQueries(facts)).slice(0, 6),
      schema_types: optimization.schema_types || ["LocalBusiness", "Service", "FAQPage", "BreadcrumbList"],
      local_presence: optimization.local_presence || {},
    },
    cache: {
      hits: Number(cache.hits || 0),
      misses: Number(cache.misses || 0),
      key: cache.key || cacheKeyFor(input),
    },
    preview: {
      job_id: preview.job_id || "",
      status: preview.status || "",
      url: preview.url || "",
      error: preview.error || "",
      qc: preview.qc || {},
    },
    remix_packet: remixPacket,
    warnings,
  };
}

function canonicalRichFacts(facts = {}, input = {}, assets = []) {
  // A discovery result may arrive in either the structured source-intake shape
  // (`found`, `branding`) or a stored packet shape (`packet.enrichment_sources`).
  // Prefer a fresh, explicit fact, then fall back to discovered evidence. Empty
  // or stale fields must never erase a better value already in the facts object.
  const discovery = firstFreshObject(facts.discovery, input.discovery);
  const enrichment = freshObject(discovery.packet?.enrichment_sources) ? discovery.packet.enrichment_sources : {};
  const discoveredBranding = firstFreshObject(
    discovery.branding,
    discovery.brand,
    enrichment.branding?.value,
  );
  const branding = {
    colors: firstFreshList(
      facts.branding?.colors,
      facts.brand?.colors,
      facts.colors,
      input.branding?.colors,
      input.brand?.colors,
      input.colors,
      discoveredBranding.colors,
      discovery.found?.colors,
      enrichment.colors?.value,
      (Array.isArray(assets) ? assets : []).filter((asset) => asset?.kind === "color" && asset.stale !== true).map((asset) => asset.meta?.value ?? asset.value ?? asset.label),
    ),
    fonts: firstFreshList(
      facts.branding?.fonts,
      facts.brand?.fonts,
      facts.fonts,
      input.branding?.fonts,
      input.brand?.fonts,
      input.fonts,
      discoveredBranding.fonts,
      discovery.found?.fonts,
    ),
  };

  return {
    copy: firstFreshText(
      facts.copy,
      input.copy,
      discovery.copy,
      discovery.found?.copy,
      enrichment.copy?.value,
    ),
    testimonials: firstFreshList(
      facts.testimonials,
      input.testimonials,
      discovery.testimonials,
      discovery.found?.testimonials,
      enrichment.reviews_attributed?.value,
    ),
    founded: firstFreshValue(
      facts.founded,
      input.founded,
      discovery.founded,
      discovery.found?.founded,
      enrichment.years?.founded,
    ),
    discovery,
    branding,
  };
}

function freshObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value.stale !== true ? value : null;
}

function firstFreshObject(...values) {
  return values.map(freshObject).find(Boolean) || {};
}

function firstFreshText(...values) {
  for (const value of values) {
    if (value?.stale === true) continue;
    const text = typeof value === "string" ? value.trim() : "";
    if (text) return text;
  }
  return "";
}

function firstFreshList(...values) {
  for (const value of values) {
    if (!Array.isArray(value) || value.stale === true) continue;
    const entries = value.filter((item) => item?.stale !== true && item && (typeof item !== "string" || item.trim()));
    if (entries.length) return entries;
  }
  return [];
}

function firstFreshValue(...values) {
  for (const value of values) {
    if (value == null || value === false || value === 0 || value?.stale === true) continue;
    if (typeof value === "string") {
      const text = value.trim();
      if (text) return text;
      continue;
    }
    return value;
  }
  return null;
}

function boundedServices(facts = {}) {
  const categoryDefaults = categoryDefaultServices(facts.category);
  if (categoryDefaults.length) return categoryDefaults.slice(0, 4);
  const base = facts.category || "local service";
  return [base, `${base} repair`, `${base} maintenance`].slice(0, 4);
}

// Category-true default service menus for verticals whose sites describe work
// in prose rather than scannable lists (a med spa page reads "rejuvenate your
// skin", not "Botox — $12/unit"). These are honest CATEGORY-STANDARD services —
// what every business of this type performs — used ONLY when nothing could be
// scraped, and confirmed by the business at activation (same philosophy as the
// no-website lane's labeled proposed logo). Real scraped services always win.
export const CATEGORY_DEFAULT_SERVICES = {
  "med spa": ["Botox & injectables", "Dermal fillers", "Facials & skin treatments", "Laser skin rejuvenation"],
  "dental": ["Cleanings & exams", "Fillings & crowns", "Teeth whitening", "Veneers & implants"],
  "tattoo studio": ["Custom tattoos", "Cover-ups & reworks", "Fine line & black-and-grey", "Color tattoos"],
  "photographer": ["Wedding photography", "Portrait sessions", "Engagement shoots", "Event photography"],
  "piercing": ["Ear piercings", "Body piercings", "Jewelry fitting & sales", "Aftercare guidance"],
  "attorney": ["Legal consultations", "Case evaluations", "Document preparation & review", "Client representation"],
  "massage": ["Therapeutic massage", "Deep tissue massage", "Relaxation massage", "Sports recovery massage"],
  "hair salon": ["Haircuts & styling", "Color & highlights", "Blowouts & finishing", "Hair treatments"],
  "barber": ["Haircuts & fades", "Beard trims & shaping", "Hot towel shaves", "Line-ups & tapers"],
  "nail studio": ["Manicures", "Pedicures", "Gel & acrylic sets", "Nail art & design"],
  "wedding vendor": ["Wedding planning", "Day-of coordination", "Vendor coordination", "Event design"],
};

export function categoryDefaultServices(category = "") {
  return CATEGORY_DEFAULT_SERVICES[String(category || "").toLowerCase()] || [];
}

function targetQueries(facts = {}) {
  const market = [facts.city, facts.state].filter(Boolean).join(", ");
  const cat = facts.category || "local service";
  return [`${cat} ${market}`, `${cat} near me`, `best ${cat} ${facts.city || market}`].filter(Boolean);
}

export function evidenceForFacts(input, facts, sourceContact = null) {
  const at = new Date().toISOString();
  const rows = [];
  const add = (field, value, sourceType, sourceUrl, confidence) => {
    if (!value) return;
    rows.push({ field, value, source_type: sourceType, source_url: sourceUrl || "", confidence, observed_at: at });
  };
  add("name", facts.name, input.prospect_hints?.name ? "hint" : "derived", input.sources?.website_url, input.prospect_hints?.name ? 0.8 : 0.55);
  add("city", facts.city, input.prospect_hints?.city ? "hint" : "derived", input.sources?.gbp_url || input.sources?.website_url, input.prospect_hints?.city ? 0.85 : 0.55);
  add("state", facts.state, input.prospect_hints?.state ? "hint" : "derived", input.sources?.gbp_url || input.sources?.website_url, input.prospect_hints?.state ? 0.85 : 0.55);
  add("category", facts.category, "classification", input.sources?.website_url || input.sources?.gbp_url, 0.7);
  add(
    "phone",
    facts.phone,
    sourceContact?.phone === true ? "official_source" : input.prospect_hints?.phone ? "hint" : "derived",
    input.sources?.gbp_url || input.sources?.website_url,
    sourceContact?.phone === true ? 0.95 : input.prospect_hints?.phone ? 0.4 : 0.55,
  );
  add(
    "address",
    facts.address,
    sourceContact?.address === true ? "official_source" : input.prospect_hints?.address ? "hint" : "derived",
    input.sources?.gbp_url || input.sources?.website_url,
    sourceContact?.address === true ? 0.95 : input.prospect_hints?.address ? 0.4 : 0.55,
  );
  if (Array.isArray(facts.services) && facts.services.length) {
    // Category-default menus are honest but unverified — label + score them
    // as such so downstream truth surfaces never over-claim.
    const isDefault = facts.services_source === "category_default";
    add("services", facts.services, isDefault ? "category_default" : "operator_verified", input.sources?.website_url, isDefault ? 0.6 : 0.9);
  }
  if (input.sources?.website_url) add("website", input.sources.website_url, "website", input.sources.website_url, 0.95);
  if (input.sources?.gbp_url) add("google_listing", input.sources.gbp_url, "gbp", input.sources.gbp_url, 0.75);
  if (input.sources?.social_url) add("social_profile", input.sources.social_url, "social", input.sources.social_url, 0.45);
  if (input.sources?.asset_url) add("asset_folder", input.sources.asset_url, "asset_folder", input.sources.asset_url, 0.45);
  return rows;
}

export function validateCanonicalPacket(packet) {
  const errors = [];
  if (packet?.version !== VERSION) errors.push("version");
  if (!packet?.facts?.name) errors.push("facts.name");
  if (!packet?.facts?.city) errors.push("facts.city");
  if (!packet?.facts?.state) errors.push("facts.state");
  if (!SUPPORTED_CATEGORIES.includes(packet?.facts?.category)) errors.push("facts.category");
  if (!Array.isArray(packet?.evidence) || !packet.evidence.length) errors.push("evidence");
  return { ok: errors.length === 0, errors };
}
