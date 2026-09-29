"use strict";

// Advisory service-label checker. It never rewrites the label and it does not
// replace upstream source certification: "accepted" only means the supplied
// evidence is consistent with a first-party, explicitly offered service.

const GENERIC_QUALIFIERS = new Set([
  "outdoor", "indoor", "decorative", "residential", "commercial", "general", "other",
  "additional", "specialty", "speciality", "custom", "professional", "home", "property",
  "miscellaneous", "misc", "more", "all", "full", "complete", "quality", "premium",
  "various", "exterior", "interior", "standard", "basic", "extra", "and", "&",
]);
const GENERIC_HEADS = new Set([
  "service", "services", "work", "works", "solution", "solutions", "project", "projects",
  "offering", "offerings",
]);
const SECTION_HEADINGS = new Set([
  "services", "service", "our services", "what we do", "our work", "solutions", "offerings",
  "home", "about", "about us", "contact", "contact us", "gallery", "reviews", "testimonials",
  "faq", "faqs", "blog", "projects", "menu",
]);
const EDITORIAL_SEGMENTS = new Set([
  "blog", "blogs", "news", "article", "articles", "post", "posts", "tips", "resources",
  "insights", "stories", "guides", "guide", "learn", "journal", "press", "updates", "faq", "faqs",
]);
const SERVICE_SEGMENTS = new Set([
  "services", "service", "our-services", "what-we-do", "offerings", "solutions",
]);
const FRAGMENT_STARTERS = new Set([
  "for", "to", "with", "and", "or", "but", "of", "in", "at", "by", "from", "so", "that",
  "which", "because", "if", "while", "when", "as", "than", "then", "into", "onto",
]);
const LISTICLE_WORDS = /\b(tips|ways|reasons|mistakes|ideas|secrets|tricks|myths|benefits|hacks)\b/u;
const LISTICLE_AFTER_NUMBER = /\b(steps|signs|things|questions|facts|tips|ways|reasons|mistakes|ideas|secrets|tricks|myths|benefits|hacks)\b/u;
const QUESTION_START = /^(how|why|what|when|where|which|who|should|can|do|does|is|are|will)\b/u;
const SUPERLATIVE = /\b(best|finest|greatest|number one|top-rated|top rated|leading|premier|unmatched|unbeatable|unrivaled|unrivalled|excellent|amazing|awesome|perfect|perfectly|world-class|award-winning)\b/u;
const FIRST_PERSON = /\b(we|we're|we've|we'll|we'd|our|ours|ourselves|i'm|i've|i'll|my|mine)\b/u;
const SECOND_PERSON = /\b(you|your|you're|yours|you'll|you've)\b/u;
const CONTACT_PROMPT = /^(please\s+)?(tell|contact|call|email|e-mail|text|message|reach|send|give|let|ask|request|get|book|schedule|click|learn|read|find|see|view|visit|discover|explore|start|fill)\s+(us|me|out|a|an|the|your|our|in|today|now|more|here|online|free)\b/u;
const CONTACT_US_ANYWHERE = /\b(contact|call|email|text|message) us\b/u;
const COPYRIGHT = /©|\(c\)\s*\d{4}|\bcopyright\b|all rights reserved/u;
const CONTACT_DETAIL = /https?:\/\/|\bwww\.|\S+@\S+\.[a-z]{2,}|\+?\d[\d\s().-]{8,}\d/u;
const LEGAL_SUFFIX = /[\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|co|company|corp|corporation|pllc|lp|llp)\.?$/u;

function normalize(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function words(norm) {
  return norm.split(/[^\p{L}\p{N}'&#-]+/u).filter(Boolean);
}

function nameKey(value) {
  let s = normalize(value).replace(/&/g, " and ");
  let prev;
  do { prev = s; s = s.replace(LEGAL_SUFFIX, "").trim(); } while (s !== prev);
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^the /u, "");
  return s;
}

function slugify(value) {
  return normalize(value).normalize("NFD").replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function containsPhrase(haystack, needle) {
  if (!needle) return false;
  const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[i + needle.length])) return true;
    from = i + 1;
  }
}

function rejectionReasons(label, norm, businessName) {
  const out = [];
  const w = words(norm);
  const plain = norm.replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (COPYRIGHT.test(norm)) out.push("copyright_notice");
  if (CONTACT_DETAIL.test(norm)) out.push("contact_detail");
  if (CONTACT_PROMPT.test(norm) || CONTACT_US_ANYWHERE.test(norm)) out.push("contact_prompt");
  const originalWords = String(label).normalize("NFKC").split(/[^\p{L}\p{N}']+/u);
  if (FIRST_PERSON.test(norm) || originalWords.some((x) => x === "us" || x === "Us")) {
    out.push("first_person_promotional");
  }
  if (SECOND_PERSON.test(norm)) out.push("second_person_address");
  if (norm.includes("!")) out.push("exclamatory_slogan");
  if (SUPERLATIVE.test(norm) || /#\s?1\b|\bno\.\s?1\b/u.test(norm)) out.push("marketing_superlative");
  const isArticle = norm.includes("?")
    || (QUESTION_START.test(norm) && w.length >= 3)
    || (/^\d+\s+\p{L}/u.test(norm) && LISTICLE_AFTER_NUMBER.test(norm))
    || (LISTICLE_WORDS.test(norm) && w.length >= 2)
    || /\b(guide to|ultimate guide|beginner's guide|checklist)\b/u.test(norm);
  if (isArticle) out.push("article_heading");
  if (w.length >= 3 && FRAGMENT_STARTERS.has(w[0])) out.push("sentence_fragment");
  if (/[.;]$/u.test(norm) && w.length >= 4) out.push("sentence_not_label");
  if (SECTION_HEADINGS.has(plain)) out.push("section_heading");
  if (typeof businessName === "string" && businessName.trim()) {
    const lk = nameKey(label);
    if (lk && lk === nameKey(businessName)) out.push("matches_business_name");
  }
  return [...new Set(out)];
}

function isGenericLabel(norm) {
  const w = words(norm);
  if (w.length === 0) return false;
  const heads = w.filter((x) => GENERIC_HEADS.has(x));
  if (heads.length === 0) return false;
  return w.every((x) => GENERIC_HEADS.has(x) || GENERIC_QUALIFIERS.has(x));
}

function parseHttpUrl(value, base) {
  try {
    const u = base ? new URL(value, base) : new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function hostKey(u) {
  const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return u.port ? `${host}:${u.port}` : host;
}

function hostRelation(src, biz) {
  const a = hostKey(src);
  const b = hostKey(biz);
  if (a === b) return "first_party";
  const ha = a.split(":")[0];
  const hb = b.split(":")[0];
  if (ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`)) return "related_subdomain";
  const tail = (h) => h.split(".").slice(-2).join(".");
  if (ha.includes(".") && hb.includes(".") && tail(ha) === tail(hb)) return "sibling_subdomain";
  return "different_host";
}

function segmentsOf(u) {
  return u.pathname.split("/").filter(Boolean).map((seg) => {
    let s = seg;
    try { s = decodeURIComponent(seg); } catch { /* keep raw segment */ }
    return s.normalize("NFKC").toLowerCase();
  });
}

function evaluateEvidence(input, norm) {
  const reasons = [];
  const evidence = {
    hostRelation: "unknown", pathKind: "unknown", slugMatchesLabel: false,
    labelInSourceText: false, explicitlyOffered: input.explicitlyOffered === true,
    withinTenantPath: null,
  };
  const businessRaw = typeof input.businessUrl === "string" ? input.businessUrl.trim() : "";
  const sourceRaw = typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : "";
  let biz = businessRaw ? parseHttpUrl(businessRaw) || parseHttpUrl(`https://${businessRaw}`) : null;
  if (!businessRaw) reasons.push("business_url_missing");
  else if (!biz) reasons.push("business_url_invalid");

  let src = null;
  if (!sourceRaw) reasons.push("source_url_missing");
  else {
    let base = null;
    if (biz) {
      base = new URL(biz.href);
      base.hash = ""; base.search = "";
      if (!base.pathname.endsWith("/")) base.pathname += "/";
    }
    src = parseHttpUrl(sourceRaw) || (base ? parseHttpUrl(sourceRaw, base.href) : null);
    if (!src) reasons.push(base ? "source_url_invalid" : "source_url_unresolvable_without_business_url");
  }

  if (src && biz) {
    evidence.hostRelation = hostRelation(src, biz);
    if (evidence.hostRelation !== "first_party") reasons.push(`source_host_${evidence.hostRelation}`);
    const tenant = segmentsOf(biz);
    let segs = segmentsOf(src);
    const inTenant = tenant.every((t, i) => segs[i] === t);
    evidence.withinTenantPath = inTenant;
    if (!inTenant) reasons.push("source_outside_business_tenant_path");
    else segs = segs.slice(tenant.length);
    if (segs.some((s) => EDITORIAL_SEGMENTS.has(s))) evidence.pathKind = "editorial";
    else if (segs.some((s) => SERVICE_SEGMENTS.has(s))) evidence.pathKind = "service";
    else evidence.pathKind = "other";
    const last = segs[segs.length - 1] || "";
    evidence.slugMatchesLabel = Boolean(last) && slugify(last) === slugify(norm);
    if (evidence.pathKind === "editorial") {
      reasons.push("editorial_source_path");
      if (evidence.slugMatchesLabel) reasons.push("slug_match_is_not_offering_evidence");
    }
  }

  if (typeof input.sourceText !== "string" || !input.sourceText.trim()) {
    reasons.push("source_text_missing");
  } else {
    evidence.labelInSourceText = containsPhrase(normalize(input.sourceText), norm);
    if (!evidence.labelInSourceText) reasons.push("label_not_in_source_text");
  }
  return { reasons, evidence };
}

function auditServiceLabel(input = {}) {
  const originalLabel = input ? input.label : undefined;
  if (typeof originalLabel !== "string" || !originalLabel.trim()) {
    return { status: "rejected", reasons: ["label_missing_or_not_string"], originalLabel };
  }
  const norm = normalize(originalLabel);
  const rejected = rejectionReasons(originalLabel, norm, input.businessName);
  if (rejected.length) return { status: "rejected", reasons: rejected, originalLabel };

  const { reasons, evidence } = evaluateEvidence(input, norm);
  const generic = isGenericLabel(norm);
  evidence.genericLabel = generic;
  if (words(norm).length > 8) reasons.push("label_unusually_long");
  if (generic && !evidence.explicitlyOffered) reasons.push("generic_label_requires_explicit_offering");
  if (!generic && evidence.pathKind !== "service" && !evidence.explicitlyOffered) {
    reasons.push("no_explicit_offering_evidence");
  }
  const blocking = reasons.length > 0
    || evidence.hostRelation !== "first_party"
    || !evidence.labelInSourceText
    || evidence.pathKind === "editorial";
  if (blocking) {
    return { status: "needs_review", reasons: [...new Set(reasons)], originalLabel, evidence };
  }
  const ok = ["first_party_source", "label_in_source_text"];
  if (evidence.pathKind === "service") ok.push("service_path");
  if (evidence.explicitlyOffered) ok.push("explicitly_offered");
  return { status: "accepted", reasons: ok, originalLabel, evidence };
}

module.exports = { auditServiceLabel };
