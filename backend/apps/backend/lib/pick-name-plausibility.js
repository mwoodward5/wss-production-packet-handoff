"use strict";

/**
 * pick-name-plausibility — a CONSERVATIVE pick-time prefilter for fresh-mined
 * AND shelf-held business names.
 *
 * Production evidence (line_mthqns6w_f11076abfd, 2026-08-31): the fresh-mining
 * lane admits candidates whose "businessName" is actually a scraped page
 * headline ("Welcome to Portland, Oregon") or a UI/DOM fragment ("content
 * frame"). Downstream intake certification correctly refuses both as
 * business_name_mismatch — but only AFTER a compile slot, 1-3 minutes of
 * compile time, and a batch quota slot are spent on garbage.
 *
 * Round 2 evidence (line_mthsj44q, fired 2026-08-31 ~22:11Z on the #517
 * deploy): ten MORE garbage names still reached certification — because the
 * round-1 rules were too narrow AND because the round-1 hook only covered the
 * fresh-mine admission loop. The recycled pick pool (LeadMiner packet shelf,
 * vertical shelf, freshest-store fallback) carried scraped <title> tags
 * ("Home - Backlund Plumbing"), a raw CSS selector (".wc-legacyPageTitle,
 * .GeneralHeade"), an un-rendered HTML entity ("Professional Lawn Care
 * &#038; Land"), truncated exports ("Residential + Commercial General C"), and
 * marketing taglines ("we help power the world around us.", "New and
 * Improved!", "We Build Great Places to Work") straight into batches. This
 * round widens the rules and the hook surface (see line-adapters.js).
 *
 * Round 3 evidence (line_mthuxe6u / line_mthy1zg2, 2026-09-01): certification
 * still caught civic page titles, terminally-truncated hero copy, and a small
 * family of marketing-sentence opens. Those are now refused here first.
 *
 * This prefilter refuses obviously-not-a-business-name picks at admission
 * time, BEFORE the Intake Genie compile is attempted, with the terminal cause
 * `pick_name_implausible` riding the same quarantine metadata path as
 * certification refusals (durable rejected row + refill exclusion).
 *
 * DESIGN LAW — CONSERVATIVE BY CONSTRUCTION:
 *   1. Refuse only OBVIOUSLY not-a-business names (high-precision rules).
 *   2. Guardrails run FIRST: a registered legal suffix (LLC, Inc, Co, ...),
 *      or a possessive apostrophe (O'Brien, Smith's) passes everything — no
 *      rule below may kill it. The sole pre-guard exception is a terminal
 *      ellipsis: it is direct evidence the scraped value was truncated, and a
 *      real business name never ends in "…"/"...". The ampersand guardrail
 *      (Smith & Sons) sits below raw-scrape-artifact rules only, and each such
 *      override is documented at the rule.
 *   3. Default verdict is PLAUSIBLE. The downstream certification remains the
 *      last line of defense; this filter is an optimization and slot-saver,
 *      never a replacement for it.
 *   4. Title-tag chrome is rescued, not refused: a leading "Home - " /
 *      "Welcome | " / "Index — " token followed by a separator is a scraped
 *      <title> prefix on a REAL business ("Home - Backlund Plumbing"). The
 *      prefix is stripped before admission and the remainder is evaluated
 *      normally.
 *
 * Documented boundary decisions (bias: do NOT filter when unsure):
 *   - "Best Concrete Contractor" (title case) PASSES — conceivably a real
 *     registered name. Only its sentence-case, every-token-generic variant
 *     ("Best concrete contractor") is refused as directory/tagline copy.
 *   - Only the unambiguous marketing-copy suffix "... for your project" and
 *     the marketing-phrase exclamation ("New and Improved!") are refused.
 *   - "TURNKEY DESIGN BUILD" (bare) is REFUSED as a documented judgment call:
 *     an ALL-CAPS name of 3+ tokens where every token is a generic trade
 *     descriptor — no surname, no place, no suffix, no ampersand — is
 *     directory noise (production evidence: it died business_name_mismatch in
 *     line_mthsj44q). The same words with a suffix ("TURNKEY DESIGN BUILD
 *     LLC") always pass the legal-suffix guardrail, and 2-token all-caps
 *     descriptor names ("PREMIER ROOFING", "QUALITY PLUMBING") are left to
 *     certification because conceivably-registered DBAs dominate that shape.
 *   - Round-2 leading-invitation tokens are deliberately limited to
 *     {we, experience, trusted, find, discover, explore}. "welcome" stays as
 *     the round-1 "welcome to" headline rule only ("Welcome Inn" is a real
 *     name shape); "your"/"creating"/"building" are excluded to preserve the
 *     round-1 pinned boundaries ("Your Full-Service Plumbing Partner" passes;
 *     "Building Solutions" is a plausible real name) — no round-2 garbage
 *     requires them.
 *   - Round 3 keeps a literal "&" as a PASS guardrail for the new
 *     Providing/Committed/Delivering/From shapes. The measured truncated
 *     "Providing ... & Serv…" still dies on the terminal-ellipsis rule above;
 *     an untruncated ampersand name stays admitted for certification rather
 *     than risking a real DBA. Existing round-2 invitation overrides remain
 *     unchanged.
 *   - A bare final single letter is treated as truncation only on 3+ token
 *     names and only without a period. Two-token personal/initial names such
 *     as "Robert C" and any period-terminated initial such as "Robert C."
 *     remain plausible; "Robert C. Plumbing" is unaffected.
 */

const PICK_NAME_IMPLAUSIBLE = "pick_name_implausible";

// NATIONAL-CHAIN EXCLUSION (owner directive 2026-09-01). A national franchise
// is never the prospect this pipeline sells to: it already has an agency-built
// site, a corporate web team, and a franchise agreement that forbids a rebuild.
// Every name below is refused at candidate admission with the terminal cause
// `national_chain_excluded`, riding the SAME quarantine metadata path as
// `pick_name_implausible` (durable rejected row + refill exclusion).
//
// The set is FROZEN: only genuinely national home-services majors belong here.
// A name that merely shares one generic word with a chain ("Precision Roofing"
// vs "Precision Air") does NOT match — matching is whole-phrase, so a chain
// entry only fires when its distinctive phrase appears in full.
const NATIONAL_CHAIN_EXCLUDED = "national_chain_excluded";

const NATIONAL_CHAIN_NAMES = Object.freeze([
  // Plumbing.
  "Roto-Rooter",
  "Mr. Rooter",
  "Benjamin Franklin Plumbing",
  "1-800-Plumber",
  "bluefrog Plumbing",
  "Drain Doctor",
  // HVAC.
  "Precision Air",
  "Aire Serv",
  "One Hour Heating",
  "ARS Rescue Rooter",
  // Restoration / cleaning.
  "SERVPRO",
  "ServiceMaster",
  "Stanley Steemer",
  "Chem-Dry",
  "Molly Maid",
  "Merry Maids",
  // Home services majors.
  "Sears",
  "Mr. Handyman",
  "Terminix",
  "Orkin",
  "TruGreen",
  "Bath Fitter",
  "Re-Bath",
  "CertaPro Painters",
  "Five Star Painting",
]);

// Additional chains appended from GHOST_AGENCY_CHAIN_EXCLUSIONS (comma list),
// so a new national brand can be blocked the moment it shows up in a SERP
// without shipping code.
function nationalChainNames(env = process.env) {
  const extra = parseChainList(env && env.GHOST_AGENCY_CHAIN_EXCLUSIONS);
  return extra.length ? [...NATIONAL_CHAIN_NAMES, ...extra] : [...NATIONAL_CHAIN_NAMES];
}

function parseChainList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/**
 * True when the candidate name CONTAINS a national chain's distinctive phrase.
 * Matching is whole-phrase on a punctuation-squashed lowercase form, so
 * "Roto-Rooter Plumbing of Odessa" matches ("rotorooter") while "Precision
 * Roofing" does not ("precision air" never appears). A chain entry shorter
 * than 4 alphabetic characters would match inside ordinary words and is
 * refused as unsafe rather than guessed at.
 */
function isNationalChainName(value, env = process.env) {
  const candidate = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!candidate) return false;
  return nationalChainNames(env).some((chain) => {
    const needle = String(chain || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    return needle.length >= 4 && candidate.includes(needle);
  });
}

// Registered-entity suffixes. A name ENDING in one of these tokens is treated
// as a deliberately registered business and always passes. Kept to the
// high-precision US set; deliberately excludes ambiguous two-letter endings
// (NA, SA) that ordinary words can collide with.
const LEGAL_SUFFIX_TOKENS = new Set([
  "llc", "llp", "lp", "pllc", "pc", "plc",
  "inc", "incorporated",
  "corp", "corporation",
  "co", "company",
  "ltd", "limited",
]);

// Page-headline / CTA chrome that no registered business begins with. These
// prefixes are carved out of the proper-noun assumption: "Welcome to
// Portland, Oregon" contains proper nouns yet is still a page headline.
const HEADLINE_PREFIX_PATTERNS = [
  /^welcome to\b/,
  /^home page\b/,
  /^click here\b/,
  /^learn more\b/,
  /^read more\b/,
  /^skip to\b/,
  /^contact us\b/,
  /^about us\b/,
  /^our services\b/,
  /^sign in\b/,
  /^log in\b/,
];

// Generic UI / structural / page-label vocabulary. A name whose EVERY token
// (case-insensitive, punctuation-stripped) lands in this set is page chrome
// with no proper-noun content ("content frame", "main content",
// "navigation menu"). Deliberately EXCLUDES articles ("the", "a", "an") so
// plausible names like "The Gallery" or "A & B Plumbing" can never be
// all-generic, and EXCLUDES trade words ("construction", "plumbing",
// "contractor") so keyword-y names stay admitted.
const GENERIC_UI_TOKENS = new Set([
  // DOM / structural fragments
  "content", "frame", "iframe", "main", "header", "footer", "sidebar",
  "navigation", "nav", "menu", "breadcrumb", "carousel", "slider", "gallery",
  "modal", "popup", "overlay", "banner", "button", "toggle", "tab", "tabs",
  "window", "browser", "widget", "container", "wrapper", "layout", "template",
  "placeholder", "loading", "spinner", "skeleton", "scrollbar",
  // Page labels
  "home", "homepage", "page", "pages", "website", "site", "web", "portal",
  "dashboard", "login", "logout", "signin", "register", "search", "results",
  "sitemap", "index", "archive",
  // CTA / link text
  "click", "here", "learn", "more", "read", "discover", "explore", "view",
  "close", "open", "next", "previous", "back", "skip", "to", "continue",
  "submit", "send", "download", "subscribe", "follow", "share",
  // Heading / copy fragments
  "welcome", "hello", "us", "our", "about", "contact", "services", "info",
  "information", "details", "get", "started", "today", "now",
  // Media chrome
  "video", "videos", "image", "images", "photo", "photos", "picture",
  "pictures", "map", "maps",
  // Misc page chrome
  "error", "undefined", "null", "privacy", "terms", "cookies", "policy",
  "accessibility", "comments", "comment", "leave", "reply", "cancel",
  "settings", "help", "faq", "account", "cart", "checkout",
]);

// Marketing/invitation LEADING tokens. A multi-word name starting with one of
// these is overwhelmingly scraped hero-copy ("We Build Great Places to Work",
// "Trusted Home Renovation & Building", "Experience Your Outdoor Living wit")
// — UNLESS a capitalized mid token is proper-noun-looking, in which case the
// name passes ("Explore Portland Tours" keeps its proper noun).
const INVITATION_LEADING_TOKENS = new Set([
  "we", "experience", "trusted", "find", "discover", "explore",
]);

// Round-3 sentence opens are deliberately separate from round 2 so the literal
// ampersand guardrail can remain conservative for these newly-observed shapes.
const ROUND3_MARKETING_LEADING_TOKENS = new Set([
  "providing", "committed", "delivering",
]);

// Common English words a title-cased tagline uses mid-sentence ("We Build
// Great Places to Work"). A capitalized mid token OUTSIDE this vocabulary
// ("Portland", "Regency", "Andersen") is treated as a proper noun and the
// name passes. Small by design: unknown capitalized words save the name.
const COMMON_TAGLINE_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "in", "on", "at", "of", "with",
  "from", "by", "your", "our", "you", "us", "we", "their",
  "best", "better", "good", "great", "new", "improved", "top", "rated",
  "free", "local", "trusted", "quality", "professional", "affordable",
  "reliable", "complete", "full", "general", "residential", "commercial",
  "services", "service", "solutions", "contractor", "contractors",
  "construction", "plumbing", "roofing", "heating", "cooling", "hvac",
  "electrical", "electric", "cleaning", "lawn", "landscaping", "painting",
  "paint", "repair", "repairs", "installation", "home", "homes", "house",
  "houses", "design", "designs", "build", "builds", "building", "buildings",
  "renovation", "renovations", "remodel", "remodeling", "outdoor", "indoor",
  "living", "life", "care", "experts", "expert", "specialist",
  "specialists", "more", "less", "right", "perfect", "ideal", "ultimate",
  "comfort", "style", "value", "price", "prices", "deal", "deals", "save",
  "big", "small", "wide", "every", "all", "one", "first", "next", "place",
  "places", "spaces", "space", "work", "works", "world", "power", "help",
  "today", "now", "tomorrow", "future", "dream", "dreams", "experience",
  "experiences", "true", "real", "premier", "elite", "serve", "serves",
  "serving", "wit",
  // Round-3 generic marketing vocabulary. These remain safety words only when
  // a recognized marketing sentence-open is already present.
  "product", "products", "superior", "result", "results", "modern", "company",
  "quiet", "night", "nights", "bright", "brighter", "brightest", "world",
]);

// Generic trade/descriptor words that are never surnames, placenames, or
// brands. Used ONLY by the every-token-generic shapes (all-caps 3+ tokens,
// sentence-case 3+ tokens): "TURNKEY DESIGN BUILD" and "Local trusted
// roofing experts" die, while any name carrying a surname ("Anderson
// Residential + Commercial Services"), place ("Iowa Roofing"), or unknown
// word survives.
const GENERIC_DESCRIPTOR_TOKENS = new Set([
  "turnkey", "design", "designs", "build", "builds", "home", "homes",
  "house", "houses", "residential", "commercial", "general", "contractor",
  "contractors", "professional", "professionals", "quality", "premier",
  "elite", "expert", "experts", "specialist", "specialists", "services",
  "service", "solutions", "repair", "repairs", "installation",
  "installations", "improvement", "improvements", "renovation",
  "renovations", "remodeling", "construction", "roofing", "plumbing",
  "plumber", "plumbers", "electric", "electrical", "hvac", "landscaping",
  "lawn", "care", "cleaning", "painting", "heating", "cooling", "air",
  "handyman", "local", "trusted", "affordable", "reliable", "best", "top",
  "complete", "free", "new", "improved", "indoor", "outdoor", "living",
  "concrete", "fence", "fencing", "siding", "gutter", "gutters",
  "flooring", "paving", "excavation", "demolition", "tree", "moving",
  "junk", "hauling", "pest", "pressure", "washing", "windows", "doors",
]);

// Unambiguous marketing-copy tails and phrases. No registered business ends
// in these; they are hero-copy and ad banners.
const MARKETING_COPY_SUFFIX = /for your project$/;
const MARKETING_EXCLAMATION_PHRASES = [
  /\bnew and improved\b/i,
  /\bnow open\b/i,
  /\bcoming soon\b/i,
  /\bgrand opening\b/i,
  /\bfree estimates?\b/i,
  /\bcall (?:now|today)\b/i,
  /\blimited time\b/i,
  /\bspecial offer\b/i,
  /\bsave (?:big|now|money)\b/i,
  /\bbest (?:prices|deals|values)\b/i,
  /\b\d+\s*%\s*off\b/i,
];

const ABSOLUTE_MARKETING_PATTERNS = [
  /^a modern company for a modern world$/i,
];

// Scraped <title> chrome: one leading Home/Welcome/Index token followed by a
// separator (- | : · — –). A HYPHEN separator requires whitespace on both
// sides so hyphenated real names ("Home-Style Cooking", "Welcome-Inn Foods")
// never lose their prefix; the other separators are title-tag punctuation no
// compound name uses and strip with or without surrounding whitespace.
const TITLE_TAG_PREFIX_PATTERN = /^(?:home|welcome|index)(?:\s+-\s+|\s*[:|·—–]\s*)/i;

// Raw markup / scrape artifacts. No registration ever contained these.
const CSS_OR_HASH_PREFIX = /^[.#]/;
const CODE_SYNTAX_CHARS = /[{}\[\]<>]/;
const CSS_SELECTOR_LIST = /[a-z0-9_-]+,\s*[.#][a-z0-9_-]+/i;
const HTML_ENTITY = /&(?:(?:#\d{1,7})|(?:#[xX][0-9a-fA-F]+)|(?:[a-z][a-z0-9]{1,9}));/i;
const TERMINAL_ELLIPSIS = /(?:…|\.{3})$/u;
const GOV_DOMAIN = /\.gov\b/i;
const KNOWN_CIVIC_DOMAIN_TOKENS = new Set(["louisvilleky"]);
const WELCOME_CIVIC_DOMAIN_TOKEN = /^(?:cityof|countyof)[a-z0-9-]{3,}$/i;

// US state / territory postal codes. A name ENDING in ", ST" is an address
// fragment scraped off a directory listing ("Plumbing Contractor Omaha, NE").
const US_POSTAL_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

// Punctuation stripped from token edges for comparison purposes.
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function tokenizeName(normalized) {
  return normalized
    .split(" ")
    .map((token) => token.replace(EDGE_PUNCTUATION, ""))
    .filter(Boolean);
}

/**
 * Strip a scraped <title>-tag prefix ("Home - ", "Welcome | ", "Index — ")
 * from a business name. Returns the stripped remainder when one exists and is
 * non-empty; otherwise returns the name unchanged. Rescues real businesses
 * scraped from title tags ("Home - Backlund Plumbing" -> "Backlund
 * Plumbing") instead of refusing them.
 */
function stripTitleTagPrefix(value) {
  const normalized = normalizeName(value);
  const stripped = normalizeName(normalized.replace(TITLE_TAG_PREFIX_PATTERN, ""));
  return stripped ? stripped : normalized;
}

function legalSuffixTail(tokens) {
  return tokens.length >= 2 && LEGAL_SUFFIX_TOKENS.has(tokens[tokens.length - 1].toLowerCase());
}

// A capitalized non-first token that is NOT generic tagline vocabulary looks
// like a proper noun (a place, surname, or brand): "Explore Portland Tours"
// and "Find Regency Roofing" pass on it.
function properNounLookalikeToken(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const first = [...token][0] || "";
    if (!/\p{Lu}/u.test(first)) continue;
    if (!COMMON_TAGLINE_WORDS.has(token.toLowerCase())) return true;
  }
  return false;
}

function wordCount(normalized) {
  return normalized.split(" ").filter((word) => /\S/.test(word)).length;
}

function allTokensGenericDescriptors(tokens) {
  return tokens.every((token) => GENERIC_DESCRIPTOR_TOKENS.has(token.toLowerCase()));
}

function civicPageTitle(normalized, tokens) {
  if (GOV_DOMAIN.test(normalized)) return true;
  if (tokens.some((token) => KNOWN_CIVIC_DOMAIN_TOKENS.has(token.toLowerCase()))) return true;
  if (tokens[0]?.toLowerCase() !== "welcome" || tokens.length < 2) return false;
  return WELCOME_CIVIC_DOMAIN_TOKEN.test(tokens[1].toLowerCase());
}

function round3MarketingSentence(tokens, lower) {
  if (tokens.length < 2 || properNounLookalikeToken(tokens)) return false;
  const first = tokens[0].toLowerCase();
  if (ROUND3_MARKETING_LEADING_TOKENS.has(first)) return true;
  if (first === "experience" && tokens[1]?.toLowerCase() === "the") return true;
  if (first === "from" && /\bto\b/.test(lower)) return true;
  return ABSOLUTE_MARKETING_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * @param {string} value candidate business name
 * @returns {boolean} true when the name is plausibly a business name (admit),
 *   false only when it is OBVIOUSLY not one (refuse, pick_name_implausible).
 *   A "Home - "-shaped title prefix is stripped before the verdict, so
 *   pickNamePlausible("Home - Backlund Plumbing") is the verdict for
 *   "Backlund Plumbing".
 */
function pickNamePlausible(value) {
  const normalized = normalizeName(stripTitleTagPrefix(value));
  if (normalized.length < 2) return false; // empty / whitespace / 1-char cap
  if (!/\p{L}/u.test(normalized)) return false; // digits/symbols only ("123", "24/7", "!")
  const tokens = tokenizeName(normalized);
  if (!tokens.length) return false;

  // UNAMBIGUOUS TRUNCATION — deliberately the sole rule above registered-name
  // guardrails. A terminal ellipsis is the scraper saying the value was cut;
  // it must also catch "From ... life's ... m…", whose apostrophe would
  // otherwise trigger the possessive guardrail.
  if (TERMINAL_ELLIPSIS.test(normalized)) return false;

  // GUARDRAILS FIRST — the filter must never kill a real business.
  if (legalSuffixTail(tokens)) return true; // "..., LLC"
  if (/['\u2019]/.test(normalized)) return true; // possessive: O'Brien, Smith's
  if (tokens.length === 1 && LEGAL_SUFFIX_TOKENS.has(tokens[0].toLowerCase())) return false; // "LLC" alone is not a name

  // RAW SCRAPE ARTIFACTS — these run ABOVE the ampersand guardrail on
  // purpose: a name carrying markup syntax or an un-rendered HTML entity is
  // a scrape fragment no registration ever contained, even when it also
  // carries an "&" (production: "Professional Lawn Care &#038; Land").
  // "Smith & Sons" and "H&R Block" contain no entity/markup and are safe.
  if (CSS_OR_HASH_PREFIX.test(normalized)) return false; // ".wc-legacyPageTitle, ..." / "#main"
  if (CODE_SYNTAX_CHARS.test(normalized)) return false; // "{}", "[]", "<", ">"
  if (CSS_SELECTOR_LIST.test(normalized)) return false; // ".foo, .bar" selector lists
  if (HTML_ENTITY.test(normalized)) return false; // "&#038;", "&amp;", "&quot;"

  // Civic page-title/domain artifacts are source chrome, not a business name.
  // The non-.gov heuristic is intentionally tiny: only the measured
  // Louisvilleky token plus explicit cityof*/countyof* tokens after Welcome.
  if (civicPageTitle(normalized, tokens)) return false;

  // MARKETING TAGLINE SHAPES — also above the ampersand guardrail because
  // the round-2 evidence ("Trusted Home Renovation & Building") carries one.
  // Proper-noun safety: a capitalized mid token outside the tagline
  // vocabulary saves the name; "Trust Building & Construction" does not even
  // match ("Trust" is not an invitation token — only "Trusted" is).
  if (tokens.length >= 2 && INVITATION_LEADING_TOKENS.has(tokens[0].toLowerCase())
    && !properNounLookalikeToken(tokens)) return false;

  if (normalized.includes("&")) return true; // Smith & Sons; round-3 literal-& judgment: admit

  // High-precision page-headline prefixes ("Welcome to Portland, Oregon").
  const lower = normalized.toLowerCase().replace(EDGE_PUNCTUATION, "");
  if (HEADLINE_PREFIX_PATTERNS.some((pattern) => pattern.test(lower))) return false;

  // Round-3 marketing sentence starts. Legal suffixes, possessives and literal
  // ampersands already passed; a capitalized unknown mid-token (proper noun)
  // also saves the name.
  if (round3MarketingSentence(tokens, lower)) return false;

  // Pure generic UI/structural fragments with no proper-noun content
  // ("content frame", "main content", "navigation menu").
  if (tokens.every((token) => GENERIC_UI_TOKENS.has(token.toLowerCase()))) return false;

  // Unambiguous marketing copy ("... for your project", "New and Improved!").
  if (MARKETING_COPY_SUFFIX.test(lower)) return false;
  if (/!$/.test(normalized) && MARKETING_EXCLAMATION_PHRASES.some((pattern) => pattern.test(normalized))) return false;

  // All-lowercase multi-word sentence with a trailing period — hero copy
  // ("we help power the world around us."). Real names are never this shape.
  if (wordCount(normalized) >= 3 && !/\p{Lu}/u.test(normalized) && /\.$/.test(normalized)) return false;

  // Address fragment: a name ending in ", <US postal code>" is a directory
  // listing line ("Plumbing Contractor Omaha, NE"). "LS Ready Mix, LLC" is
  // untouched (3-letter suffix, and the legal-suffix guardrail already ran).
  const postalTail = /,\s*([A-Za-z]{2})\s*$/.exec(normalized);
  if (postalTail && US_POSTAL_CODES.has(postalTail[1].toUpperCase())) return false;

  // Truncated export: a 3+-token name whose final token is a bare single letter
  // was cut off mid-word by a scraper ("Residential + Commercial General C").
  // A terminal period makes it an explicit initial and is admitted; two-token
  // "Robert C" is deliberately admitted. Ampersand names already passed.
  const rawFinalToken = normalized.split(" ").filter(Boolean).at(-1) || "";
  if (tokens.length >= 3
    && tokens[tokens.length - 1].length === 1
    && !/\p{L}\.$/u.test(rawFinalToken)) return false;

  // Every-token-generic descriptor shapes (no surname, place, or brand
  // anywhere): ALL-CAPS 3+ ("TURNKEY DESIGN BUILD") and sentence-case 3+
  // ("Local trusted roofing experts") are directory noise. 2-token all-caps
  // ("PREMIER ROOFING") and title case ("Best Concrete Contractor") stay
  // admitted — conceivably registered names dominate those shapes.
  if (tokens.length >= 3 && allTokensGenericDescriptors(tokens)) {
    const isAllCaps = normalized === normalized.toUpperCase() && /\p{Lu}/u.test(normalized);
    const isSentenceCase = /^\p{Lu}/u.test(normalized)
      && tokens.slice(1).every((token) => !/^\p{Lu}/u.test(token));
    if (isAllCaps || isSentenceCase) return false;
  }

  return true;
}

module.exports = {
  PICK_NAME_IMPLAUSIBLE,
  NATIONAL_CHAIN_EXCLUDED,
  NATIONAL_CHAIN_NAMES,
  nationalChainNames,
  isNationalChainName,
  pickNamePlausible,
  stripTitleTagPrefix,
};
