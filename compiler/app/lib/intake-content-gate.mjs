const PLACEHOLDER_EMAIL = /^(?:filler|example|test|demo|sample|noreply|no-reply)@|@(?:example\.(?:com|net|org)|godaddy\.com|wix\.com|squarespace\.com|mysite\.com)$/i;
const GENERIC_NAME_WORD = /^(?:and|co|company|corp|corporation|inc|llc|ltd|the|service|services|roofing|plumbing|hvac|landscaping|contracting|contractor|construction)$/i;

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedText(value = "") {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function usablePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 && !/^(\d)\1{9}$/.test(local) && !/^\d{3}55501\d{2}$/.test(local);
}

function usableEmail(value = "") {
  const email = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) && !PLACEHOLDER_EMAIL.test(email);
}

export function sourceSafeEmail(value = "") {
  return usableEmail(value) ? clean(value) : "";
}

function usableAddress(value = "") {
  const address = clean(value);
  return address.length >= 8
    && /\d/.test(address)
    && !/^(?:area|location|address|street)\s*\d*$/i.test(address);
}

function publicHost(value = "") {
  try {
    return new URL(clean(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sameHost(left = "", right = "") {
  const a = publicHost(left);
  const b = publicHost(right);
  return Boolean(a && b && a === b);
}

function sourceText(discovery = {}) {
  return normalizedText([
    discovery.found?.copy,
    discovery.found?.services?.join?.(" "),
  ].filter(Boolean).join(" "));
}

// ---- site industry vs requested vertical (2026-09-09 El Rio incident) ------
// The official website of a real pediatric healthcare organization certified as
// a "general contracting" prospect: the name+city identity tokens matched and
// nothing ever compared the crawl's own industry signals (pediatric / health
// center / dental / pharmacy) against the requested vertical. The backend's
// authorized_category_mismatch reasons could not catch it because the packet's
// category was itself derived from the operator's request text — claim vs
// claim. This gate closes that hole on the compiler side.
//
// Law of the gate (deliberately conservative, symmetric):
//   - Refuse ONLY on a hard contradiction: the official crawl shows at least
//     two hits of a strong out-of-domain industry signal AND that industry
//     family differs from the requested vertical's family.
//   - No clear crawl signal, no requested category, a same-family match, or a
//     sanctioned compatible pair abstains (allows). Truth gates are never
//     weakened here; this strengthens one.
const VERTICAL_FAMILY = new Map(Object.entries({
  // Canonical compiler categories (intake-genie-core SUPPORTED_CATEGORIES).
  "dental": "dental",
  "med spa": "beauty_wellness",
  "massage": "beauty_wellness",
  "hair salon": "beauty_wellness",
  "barber": "beauty_wellness",
  "nail studio": "beauty_wellness",
  "tattoo studio": "beauty_wellness",
  "piercing": "beauty_wellness",
  "photographer": "events_media",
  "wedding vendor": "events_media",
  "attorney": "legal",
  "roofing": "home_trade",
  "plumbing": "home_trade",
  "hvac": "home_trade",
  "pool service": "home_trade",
  "landscaping": "home_trade",
  "electrical": "home_trade",
  "concrete": "home_trade",
  "fencing": "home_trade",
  "painting": "home_trade",
  "cleaning": "home_trade",
  "solar": "home_trade",
  "pest control": "home_trade",
  "tree care": "home_trade",
  "excavation": "home_trade",
  "general contracting": "home_trade",
  "garage door": "home_trade",
  "auto detailing": "home_trade",
  "ceramic coating": "home_trade",
  // Defensive raw-label aliases (mirror of the backend CATEGORY_FAMILY_ALIASES
  // intent) so a synonym vertical still lands in the same family instead of
  // silently abstaining.
  "plumber": "home_trade",
  "plumbers": "home_trade",
  "plumbing contractor": "home_trade",
  "roofer": "home_trade",
  "roofers": "home_trade",
  "roofing contractor": "home_trade",
  "electrician": "home_trade",
  "electricians": "home_trade",
  "electrical contractor": "home_trade",
  "hvac contractor": "home_trade",
  "heating and air": "home_trade",
  "air conditioning": "home_trade",
  "air conditioning contractor": "home_trade",
  "heating contractor": "home_trade",
  "landscaper": "home_trade",
  "hardscaping": "home_trade",
  "arborist": "home_trade",
  "arborists": "home_trade",
  "tree removal": "home_trade",
  "tree service": "home_trade",
  "remodeler": "home_trade",
  "remodeling contractor": "home_trade",
  "construction": "home_trade",
  "construction company": "home_trade",
  "general contractor": "home_trade",
  "carpentry": "home_trade",
  "concrete contractor": "home_trade",
  "mason": "home_trade",
  "fence contractor": "home_trade",
  "garage doors": "home_trade",
  "exterminator": "home_trade",
  "water damage": "home_trade",
  "restoration": "home_trade",
  "water damage restoration": "home_trade",
  "car detailing": "home_trade",
  "detailer": "home_trade",
  "ceramic coatings": "home_trade",
  "medical spa": "beauty_wellness",
  "medspa": "beauty_wellness",
  "tattoo": "beauty_wellness",
  "tattoo artist": "beauty_wellness",
  "tattoo artists": "beauty_wellness",
  "tattoo shop": "beauty_wellness",
  "piercer": "beauty_wellness",
  "piercing studio": "beauty_wellness",
  "massage therapist": "beauty_wellness",
  "salon": "beauty_wellness",
  "hair salons": "beauty_wellness",
  "barbershop": "beauty_wellness",
  "barber shop": "beauty_wellness",
  "nail salon": "beauty_wellness",
  "nail salons": "beauty_wellness",
  "lawyer": "legal",
  "law firm": "legal",
  "legal services": "legal",
  "solo attorney": "legal",
  "photography": "events_media",
  "realtor": "real_estate",
  "realtors": "real_estate",
  "realty": "real_estate",
  "real estate": "real_estate",
  "restaurant": "restaurant",
  "medical clinic": "medical",
  "pediatrician": "medical",
  "veterinary": "veterinary",
}));

// Hybrid businesses these two families legitimately share copy for (bridal
// salons, wedding makeup artists, salon photographers). Never refuse across
// this pair; every other distinct family pair is a hard contradiction.
const COMPATIBLE_FAMILY_PAIRS = new Set(["beauty_wellness\u0000events_media"]);

// High-precision crawl-side industry detectors, checked in order; the first
// family reaching CRAWL_INDUSTRY_MIN_HITS total regex matches wins. Patterns
// avoid generic words contractors use incidentally ("kitchen", "insurance
// claim", "landscape", "menu") so a trade site listing commercial clients
// ("we serve restaurants, dental offices, and retailers") stays far below the
// two-hit floor and abstains.
const CRAWL_INDUSTRY_SIGNALS = [
  ["dental practice", "dental", [
    /\bdentist(?:s|ry)?\b/gi, /\bdental\b/gi, /\borthodont\w*/gi, /\bperiodont\w*/gi,
    /\bendodont\w*/gi, /\bDDS\b/g, /\bDMD\b/g, /\binvisalign\b/gi, /\bteeth\s+whitening\b/gi,
  ]],
  ["med spa", "beauty_wellness", [
    /\bmed(?:ical)?\s*spas?\b/gi, /\bmedspa\b/gi, /\bbotox\b/gi, /\bdysport\b/gi,
    /\bdermal\s+fillers?\b/gi, /\bhydrafacial/gi, /\blaser\s+hair\s+removal\b/gi,
  ]],
  ["veterinary clinic", "veterinary", [
    /\bveterinar\w*/gi, /\banimal\s+hospitals?\b/gi, /\bspay\s+(?:and|&)\s+neuter\b/gi,
  ]],
  ["medical clinic", "medical", [
    /\bpediatric\w*/gi, /\burgent\s+care\b/gi, /\bprimary\s+care\b/gi,
    /\bfamily\s+medicine\b/gi, /\binternal\s+medicine\b/gi, /\bphysicians?\b/gi,
    /\bmedical\s+clinics?\b/gi, /\bhealth\s+centers?\b/gi, /\bcommunity\s+health\b/gi,
    /\bhealth\s*care\b/gi, /\bhealthcare\b/gi, /\bhospitals?\b/gi, /\bemergency\s+rooms?\b/gi,
    /\bpharmac(?:y|ies|ists?)\b/gi, /\bimmunizations?\b/gi, /\bvaccinations?\b/gi,
    /\bvaccines?\b/gi, /\boncolog\w*/gi, /\bcardiolog\w*/gi, /\bradiolog\w*/gi,
    /\bobstetric\w*/gi, /\bgynecolog\w*/gi, /\bmidwif\w*/gi, /\bchiropractic\b/gi,
    /\bmental\s+health\b/gi, /\bbehavioral\s+health\b/gi, /\bx-?rays?\b/gi,
    /\bpatients?\b/gi,
  ]],
  ["law firm", "legal", [
    /\blaw\s+firms?\b/gi, /\blaw\s+offices?\b/gi, /\battorneys?\b/gi, /\blawyers?\b/gi,
    /\blegal\s+services\b/gi, /\bpersonal\s+injury\b/gi, /\bfamily\s+law\b/gi,
    /\bcriminal\s+defense\b/gi, /\blegal\s+representation\b/gi,
  ]],
  ["restaurant", "restaurant", [
    /\brestaurants?\b/gi, /\bcaf[eé]\b/gi, /\bbaker(?:y|ies)\b/gi, /\bpizzerias?\b/gi,
    /\btacos?\b/gi, /\bsushi\b/gi, /\bfood\s+trucks?\b/gi, /\bhappy\s+hour\b/gi,
    /\bbrunch\b/gi, /\bgastropubs?\b/gi, /\bcoffee\s+shops?\b/gi, /\bbar\s+and\s+grill\b/gi,
    /\bours?\s+menus?\b/gi, /\bview\s+(?:our\s+)?menu\b/gi, /\bmenus?\s+(?:items?|prices)\b/gi,
  ]],
  ["real estate office", "real_estate", [
    /\breal\s*estate\b/gi, /\brealtors?\b/gi, /\bbrokerages?\b/gi, /\bmortgages?\b/gi,
    /\bescrow\b/gi, /\bhomes?\s+for\s+sale\b/gi, /\bopen\s+houses?\b/gi,
    /\bproperty\s+management\b/gi, /\blisting\s+agents?\b/gi,
  ]],
  ["insurance or accounting firm", "finance_insurance", [
    /\binsurance\s+(?:agenc\w+|agents?|quotes?|policies|coverage|compan\w+|brokers?)/gi,
    /\b(?:auto|home|life|health|business|renters|commercial)\s+insurance\b/gi,
    /\baccountants?\b/gi, /\baccounting\s+(?:services|firm|practice)\b/gi,
    /\bbookkeeping\b/gi, /\btax\s+(?:preparation|prep|planning|returns?)\b/gi,
    /\bCPA\b/g, /\bpayroll\s+services?\b/gi, /\bfinancial\s+(?:advisors?|advisory|plann\w*)\b/gi,
    /\bwealth\s+management\b/gi,
  ]],
  ["auto dealership", "auto_dealer", [
    /\bdealerships?\b/gi, /\bused\s+cars?\b/gi, /\btest\s+drives?\b/gi,
    /\bcertified\s+pre-?owned\b/gi, /\bbrowse\s+(?:our\s+)?inventory\b/gi,
    /\btrade-?in\s+value\b/gi,
  ]],
  // Lane02 2026-09-09: the retail group moved below every industry-specific
  // group. Its detectors are platform/CTA idioms ("add to cart", "free
  // shipping"), not industry nouns, so a salon or studio that also sells
  // products hit the two-hit floor before its own industry group was reached
  // and a GOOD candidate was refused. "retail" is not a supported compiler
  // category, so a retail reading can only ever refuse — ordering it last
  // gives real industries first claim on their vocabulary while a genuine
  // storefront-only site (no industry signals) still reads as retail.
  ["software or marketing agency", "software_agency", [
    /\bsoftware\s+(?:development|company|agency|solutions)\b/gi, /\bapp\s+development\b/gi,
    /\bweb\s+development\b/gi, /\b(?:seo|digital\s+marketing|marketing)\s+agency\b/gi,
    /\bSaaS\b/g, /\bstaff\s+augmentation\b/gi,
  ]],
  ["salon", "beauty_wellness", [
    /\bhair\s+salon/gi, /\bhair\s+studios?\b/gi, /\bhairstylist\w*/gi, /\bhair\s+stylist\w*/gi,
    /\bbarbershops?\b/gi, /\bbarber\s+shops?\b/gi, /\bmanicures?\b/gi, /\bpedicures?\b/gi,
    /\bnail\s+(?:salon|studio|bar|art|technician\w*)/gi, /\bblowouts?\b/gi, /\bbalayage\b/gi,
    /\bhair\s+extensions?\b/gi, /\bhairstyles?\b/gi,
  ]],
  ["massage and day spa", "beauty_wellness", [
    /\bmassages?\b/gi, /\bdeep\s+tissue\b/gi, /\bhot\s+stone\s+massage\b/gi,
    /\bbodywork\b/gi, /\bfacials?\b/gi, /\bwaxing\b/gi, /\beyelash\s+extensions?\b/gi,
    /\blash\s+(?:lifts?|extensions?)\b/gi, /\bday\s+spas?\b/gi,
  ]],
  ["tattoo studio", "beauty_wellness", [
    /\btattoos?\b/gi, /\btattooing\b/gi, /\bpiercings?\b/gi, /\bbody\s+piercing\b/gi,
  ]],
  ["photography or events", "events_media", [
    /\bphotography\b/gi, /\bphotographers?\b/gi, /\bvideograph\w*/gi,
    /\bphotos?\s+(?:booths?|studios?|sessions?|shoots?)\b/gi, /\bheadshots?\b/gi,
    /\bportraits?\b/gi, /\bengagement\s+(?:photos?|shoots?|sessions?)\b/gi,
    /\bbridal\b/gi, /\bquincea[nñ]eras?\b/gi,
    /\bwedding\s+(?:photograph\w*|videograph\w*|plann\w*|djs?|florists?|venues?|cater\w*)/gi,
    /\bevent\s+plann\w*/gi,
  ]],
  ["gym or fitness studio", "fitness", [
    /\bgym\b/gi, /\bfitness\s+(?:centers?|clubs?|studios?|gyms?|classes)\b/gi,
    /\bpersonal\s+train\w*/gi, /\bCrossFit\b/gi, /\bpilates\b/gi,
    /\byoga\s+(?:studios?|classes)\b/gi, /\bmartial\s+arts\b/gi, /\btaekwondo\b/gi,
    /\bjiu-?jitsu\b/gi, /\bspin\s+classes?\b/gi,
  ]],
  ["school or childcare", "education", [
    /\bpreschools?\b/gi, /\bdaycares?\b/gi, /\bday\s+care\b/gi, /\bkindergarten\b/gi,
    /\bmontessori\b/gi, /\b(?:elementary|middle|high|private|charter|parochial)\s+schools?\b/gi,
    /\bschool\s+districts?\b/gi, /\btutoring\b/gi, /\btutors?\b/gi, /\bchild\s+care\b/gi,
    /\bcommunity\s+colleges?\b/gi, /\buniversity\b/gi,
  ]],
  ["hotel or lodging", "lodging", [
    /\bhotels?\b/gi, /\bmotels?\b/gi, /\bbed\s*(?:&|and)\s*breakfast\b/gi, /\bB&B\b/g,
    /\bbook\s+your\s+stay\b/gi, /\bvacation\s+rentals?\b/gi, /\bcheck-?in\s+time\b/gi,
  ]],
  // Reverse direction: a crawl that reads as a trade contradicting a requested
  // non-trade vertical. Profession-grade tokens only — no bare generic words
  // ("concrete evidence", "painting classes", "under renovation").
  ["home service trades", "home_trade", [
    /\broofing\b/gi, /\broofs?\b/gi, /\bshingles?\b/gi, /\bgutters?\b/gi,
    /\bplumbing\b/gi, /\bplumbers?\b/gi, /\bwater\s+heaters?\b/gi, /\bHVAC\b/g,
    /\bair\s+conditioning\b/gi, /\bfurnaces?\b/gi, /\bheat\s+pumps?\b/gi,
    /\belectricians?\b/gi, /\bcircuit\s+breakers?\b/gi, /\blandscaping\b/gi,
    /\blandscapers?\b/gi, /\bhardscap\w+/gi, /\blawn\s+care\b/gi, /\birrigation\b/gi,
    /\bfencing\b/gi, /\bpool\s+(?:services?|cleaning|maintenance|repairs?)\b/gi,
    /\bsolar\s+(?:panels?|installation)\b/gi, /\bpest\s+control\b/gi,
    /\bexterminat\w+/gi, /\btermites?\b/gi, /\btree\s+(?:removal|service|care|trimming)\b/gi,
    /\barborists?\b/gi, /\bstump\s+removal\b/gi, /\bexcavat\w+/gi,
    /\bpressure\s+washing\b/gi, /\bpower\s+washing\b/gi, /\bhouse\s+cleaning\b/gi,
    /\bjanitorial\b/gi, /\bgeneral\s+contractor\w*/gi, /\bgeneral\s+contracting\b/gi,
    /\bconstruction\s+(?:compan\w+|services|crews?)\b/gi,
    /\bremodeling\s+(?:contractor\w*|services?)\b/gi,
    /\b(?:kitchen|bathroom)\s+(?:remodel\w*|renovation\w*)\b/gi,
    /\bhome\s+builders?\b/gi, /\bgarage\s+doors?\b/gi, /\bauto\s+detailing\b/gi,
    /\bcar\s+detailing\b/gi, /\bceramic\s+coating\b/gi, /\bwater\s+damage\s+restoration\b/gi,
    /\bdrain\s+cleaning\b/gi, /\bsump\s+pumps?\b/gi, /\bjunk\s+removal\b/gi,
  ]],
  ["retail or ecommerce store", "retail", [
    /\badd\s+to\s+cart\b/gi, /\bshopping\s+cart\b/gi, /\bfree\s+shipping\b/gi,
    /\be-?commerce\b/gi, /\bshopify\b/gi, /\bonline\s+(?:store|shop)\b/gi,
    /\bproduct\s+categories\b/gi,
  ]],
];

// Two total hits: one stray mention ("we serve restaurants") abstains; a site
// genuinely about another industry repeats its domain vocabulary.
const CRAWL_INDUSTRY_MIN_HITS = 2;

function familyPairKey(left, right) {
  return [left, right].sort().join("\u0000");
}

export function classifyCrawlIndustry(discovery = {}) {
  const found = discovery && typeof discovery === "object" ? discovery.found || {} : {};
  const text = [
    typeof found.copy === "string" ? found.copy : "",
    Array.isArray(found.services) ? found.services.join(" ") : "",
  ].filter((part) => part.trim()).join(" ");
  if (!text.trim()) return null;
  for (const [label, family, patterns] of CRAWL_INDUSTRY_SIGNALS) {
    // "Health care" also describes trees and plants. Repetition alone cannot
    // identify a human clinic; retain the existing two-hit threshold but require
    // at least one of this family's more specific clinical signals as well.
    if (family === "medical") {
      const specific = patterns.some(pattern => ![String.raw`\bhealth\s*care\b`, String.raw`\bhealthcare\b`].includes(pattern.source)
        && new RegExp(pattern.source, pattern.flags).test(text));
      if (!specific) continue;
    }
    let hits = 0;
    for (const pattern of patterns) {
      const global = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      hits += (text.match(new RegExp(pattern.source, global)) || []).length;
      if (hits >= CRAWL_INDUSTRY_MIN_HITS) return { label, family };
    }
  }
  return null;
}

export function siteIndustryContradiction(input = {}, facts = {}, discovery = {}) {
  const requestedVertical = clean(input.prospect_hints?.category || facts.category || "").toLowerCase();
  const requestedFamily = VERTICAL_FAMILY.get(requestedVertical) || "";
  if (!requestedFamily) return null;
  const crawl = classifyCrawlIndustry(discovery);
  if (!crawl || crawl.family === requestedFamily) return null;
  if (COMPATIBLE_FAMILY_PAIRS.has(familyPairKey(crawl.family, requestedFamily))) return null;
  return {
    requested_vertical: requestedVertical,
    requested_family: requestedFamily,
    crawl_industry: crawl.label,
    crawl_family: crawl.family,
  };
}

function significantNameTokens(name = "") {
  return normalizedText(name)
    .split(" ")
    .filter((token) => token.length >= 4 && !GENERIC_NAME_WORD.test(token));
}

function discoveryIsFromOfficialHost(input = {}, discovery = {}) {
  const website = clean(input.sources?.website_url);
  if (!publicHost(website)) return false;

  const observedWebsite = clean(discovery.facts?.website);
  if (observedWebsite) return sameHost(website, observedWebsite);

  const observedSources = Array.isArray(discovery.sources) ? discovery.sources : [];
  if (observedSources.some((url) => sameHost(website, url))) return true;

  // The legacy Firecrawl fallback receives the operator-supplied website as
  // its one crawl root, but does not retain that URL in its result packet.
  return clean(discovery.summary?.mode).toLowerCase() === "firecrawl";
}

function samePhone(left = "", right = "") {
  const digits = (value) => String(value || "").replace(/\D/g, "").slice(-10);
  return usablePhone(left) && usablePhone(right) && digits(left) === digits(right);
}

function sameEmail(left = "", right = "") {
  return usableEmail(left)
    && usableEmail(right)
    && clean(left).toLowerCase() === clean(right).toLowerCase();
}

function sameAddress(left = "", right = "") {
  return usableAddress(left)
    && usableAddress(right)
    && normalizedText(left) === normalizedText(right);
}

function officialSourceContact(input = {}, facts = {}, discovery = {}) {
  const result = { phone: false, email: false, address: false };
  if (!discoveryIsFromOfficialHost(input, discovery)) return result;

  const sourceFacts = discovery.facts || {};
  const foundContact = discovery.found?.contact || {};
  result.phone = [sourceFacts.phone, foundContact.phone].some((value) => samePhone(facts.phone, value));
  result.email = [sourceFacts.email, foundContact.email].some((value) => sameEmail(facts.email, value));
  result.address = [sourceFacts.address, foundContact.address].some((value) => sameAddress(facts.address, value));
  return result;
}

function sourceProvesIdentity(input = {}, facts = {}, discovery = {}) {
  const source = discovery && typeof discovery === "object" ? discovery : {};
  const pagesRead = Number(source.summary?.pages_read || 0);
  const officialSource = clean(
    input.sources?.website_url
    || source.facts?.website
    || source.sources?.find?.((url) => /^https?:\/\//i.test(String(url || ""))),
  );
  if (
    !officialSource
    || pagesRead < 1
    || !discoveryIsFromOfficialHost(input, source)
    || !clean(facts.name)
    || !clean(facts.city)
  ) return false;

  const haystack = sourceText(source);
  if (!haystack) return false;

  const tokens = significantNameTokens(facts.name);
  const nameMatch = tokens.length > 0 && tokens.every((token) => haystack.split(" ").includes(token));
  const cityMatch = normalizedText(facts.city)
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.split(" ").includes(token));
  return nameMatch && cityMatch;
}

/**
 * Fail closed unless usable contact truth is bound to the official source
 * host, or deterministic entity evidence independently proves the business.
 * Thin copy/media remains allowed when an operator-verified GBP listing or the
 * official source proves business name + city.
 */
export function assessMinimumContent({ input = {}, facts = {}, discovery = {} } = {}) {
  const contact = {
    phone: usablePhone(facts.phone),
    email: usableEmail(facts.email),
    address: usableAddress(facts.address),
  };
  const sourceContact = officialSourceContact(input, facts, discovery);
  // Refuse BEFORE identity succeeds: a perfectly-identified official site
  // (El Rio 2026-09-09) whose own industry hard-contradicts the requested
  // vertical must never certify, no matter how strong the name/city/contact
  // match is. No crawl signal or a same-family signal abstains above.
  const contradiction = siteIndustryContradiction(input, facts, discovery);
  if (contradiction) {
    return {
      ok: false,
      code: "site_industry_contradicts_vertical",
      reason: `The official-source crawl reads as a ${contradiction.crawl_industry}, which contradicts the requested ${contradiction.requested_vertical} vertical.`,
      contact,
      source_contact: sourceContact,
      ...contradiction,
    };
  }
  const officialIdentity = sourceProvesIdentity(input, facts, discovery);
  if (officialIdentity && (sourceContact.phone || sourceContact.email || sourceContact.address)) {
    return { ok: true, reason: "official_source_contact", contact, source_contact: sourceContact };
  }
  if (officialIdentity) {
    return { ok: true, reason: "official_source_identity_match", contact, source_contact: sourceContact };
  }
  return {
    ok: false,
    code: "minimum_content_identity_unresolved",
    reason: "No official-source contact or exact entity evidence proves this business.",
    contact,
    source_contact: sourceContact,
  };
}

export function sanitizeContactFacts(facts = {}, sourceContact = {}) {
  return {
    ...facts,
    phone: sourceContact.phone === true ? facts.phone : "",
    email: sourceContact.email === true ? facts.email : "",
    address: sourceContact.address === true ? facts.address : "",
  };
}
