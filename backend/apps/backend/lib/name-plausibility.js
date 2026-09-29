"use strict";

// IDENTITY PLAUSIBILITY SCREEN (audit A2 defect 2; issue #700 class).
//
// Two production escapes birthed this module:
//
//   1. "21,030 live jobs on FOX8 Jobs" (jobs.fox8.com) passed
//      6_first_party_identity as a PLUMBING business in Columbia SC and shipped
//      live in a SENT site's title/header/hero/contact/footer. The job board
//      publishes schema.org name+PostalAddress, so the structured-identity gate
//      had nothing to refuse — the name is a page statistic, not an entity.
//   2. "TexAgs - Texas A&M Football, Recruiting, News & Forums" (issue #700)
//      — a fan forum admitted as a roofing prospect the same way.
//
// The screen is deliberately TIGHT and name-field-only: it refuses a candidate
// ONLY when the harvested business name itself reads as a platform page title
// or a platform statistic, or when the homepage HTML carries ≥2 independent
// forum/board/UGC marker families (issue #700's request, measured at
// 2_homepage_fetch off the fetch already in flight — the #694
// integration-gap signal pass, zero new network calls). Unusual-but-real
// names ("24/7 Emergency Plumbing LLC", "411 Plumbing", "Job's Plumbing")
// must flow: digits, possessives and trade words are never refused alone.
//
// THIN-FLOW LAW: every refusal is RECORDED on the funnel stage (rejects list +
// stage counters) exactly like no_business_name — one candidate is gated, the
// batch always continues.

// A count phrase is a grouped or 3+ digit number followed within a few words
// by a counting noun: "21,030 live jobs", "4,832 job listings", "250 results".
// A lone number ("24/7", "411", "2 Men and a Truck") never fires.
const COUNTING_NOUNS = new Set([
  "jobs", "job", "listings", "listing", "results", "result",
  "posts", "post", "threads", "thread", "members", "member",
  "classifieds", "ads", "items", "businesses", "profiles",
  "vacancies", "vacancy", "openings", "opening", "companies",
  "topics", "reviews",
]);
const COUNT_PHRASE_WINDOW = 4;

// The head noun of a name is its last significant word. When the head noun IS
// a platform noun, the "business" is the platform: "FOX8 Jobs", "TexAgs …
// News & Forums", "Columbia SC Classifieds". Mid-name platform words never
// fire ("Community Heating & Cooling", "Job's Plumbing & Repair" pass).
const PLATFORM_HEAD_NOUNS = new Set([
  "jobs", "job", "forum", "forums", "directory", "directories",
  "classifieds", "classified", "news", "community", "communities",
  "board", "boards", "listing", "listings", "bulletin", "bulletins",
]);

// Legal-entity suffixes are stripped before the head noun is read, so
// "Fox8 Jobs LLC" is still the platform, while "M & J Plumbing Inc" reads
// "plumbing". Only unambiguous suffixes; "Company", "Services" etc. are NOT
// stripped (they are ordinary name words).
const LEGAL_SUFFIXES = new Set([
  "llc", "l.l.c.", "inc", "inc.", "corp", "corp.", "corporation",
  "ltd", "ltd.", "pllc", "lp", "llp", "co", "co.",
]);

// Issue #700's marker families, measured off the stage-2 homepage HTML.
// A family fires only on its own strong evidence; the platform verdict needs
// TWO OR MORE families, so a plumber's careers page ("search jobs") or a
// WordPress footer forum link can never refuse a real business.
const FORUM_SOFTWARE_MARK = /phpbb|vbulletin|xenforo|xen ?foro|invision|ip\.board|mybb|proboards|flarum|simplemachines|smf ?forum|discourse|nodebb|bbpress|woltlab|burning ?board|vanilla ?forums/i;
const FORUM_THREAD_URL_MARK = /href\s*=\s*["'][^"']*(?:\/forums?\/|\/threads?\/|\/viewtopic\.php|\/showthread\.php|\/member\.php|\/discussion\/|\/topics?\/)[^"']*["']/gi;
const FORUM_THREAD_URL_MIN = 3;
const LOGIN_MARK = /\b(?:log ?in|sign ?in|register|create (?:an? )?account)\b/i;
const UGC_COUNT_TEXT_MARKS = [/\bposts\b/i, /\breplies\b/i, /\bthreads\b/i, /\bmembers\b/i, /latest\s*:/i, /\bjoined\b/i];
const UGC_COUNT_TEXT_MIN = 2;
const JOB_BOARD_PHRASES = [
  /\bbrowse jobs\b/i, /\bsearch jobs\b/i, /\bpost a job\b/i,
  /\bjob categories\b/i, /\bfeatured jobs\b/i, /\bjobs near (?:you|me)\b/i,
  /\bcompanies hiring\b/i, /\bjob listings?\b/i, /\bjob (?:seekers?|alerts?)\b/i,
  /\bupload (?:your )?resume\b/i, /\bfind (?:a )?job\b/i,
];
const JOB_BOARD_PHRASE_MIN = 2;

function wordTokens(name) {
  return String(name || "")
    .replace(/[&]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isNumericCount(token) {
  const digits = token.replace(/[,.\s]/g, "");
  if (!digits || !/^\d+$/.test(digits)) return false;
  // "21,030" (comma-grouped) or any standalone 3+ digit count. "24/7" and
  // "411" have no counting noun nearby, so they never fire alone.
  return /,\d{3}/.test(token) || digits.length >= 3;
}

function stripTrailingPunctuation(token) {
  return token.replace(/[,.;:!?)\]}'"]+$/, "").replace(/^[('"\[{]+/, "");
}

function headNounOf(name) {
  const tokens = wordTokens(name);
  while (tokens.length) {
    const last = stripTrailingPunctuation(tokens[tokens.length - 1].toLowerCase());
    if (LEGAL_SUFFIXES.has(last)) { tokens.pop(); continue; }
    // Skip pure separators left after entity-suffix stripping ("M & J Plumbing Inc").
    if (!/[a-z0-9]/i.test(last)) { tokens.pop(); continue; }
    return last;
  }
  return "";
}

function countPhraseIn(text) {
  const tokens = wordTokens(text);
  for (let i = 0; i < tokens.length; i++) {
    if (!isNumericCount(tokens[i])) continue;
    const window = tokens.slice(i + 1, i + 1 + COUNT_PHRASE_WINDOW);
    for (const raw of window) {
      const word = stripTrailingPunctuation(raw.toLowerCase());
      if (COUNTING_NOUNS.has(word)) {
        return `${tokens[i]} ${raw}`;
      }
    }
  }
  return "";
}

/**
 * Name-field quality screen. Pure; reads the harvested business name only.
 *
 * @param {string} name the resolved business name (Places name, schema.org
 *   name, or operator h1/title fallback — the screen runs after identity
 *   resolution so it covers every lane).
 * @returns {{ok: boolean, reason?: string, signals: string[]}} ok:false names
 *   the refusal reason for the funnel; signals carry the matched evidence.
 */
function businessNamePlausibility({ name } = {}) {
  const businessName = String(name || "").replace(/\s+/g, " ").trim();
  const signals = [];
  if (!businessName) return { ok: true, signals };

  const countPhrase = countPhraseIn(businessName);
  if (countPhrase) {
    signals.push(`count phrase in name: "${countPhrase}"`);
  }

  const headNoun = headNounOf(businessName);
  if (headNoun && PLATFORM_HEAD_NOUNS.has(headNoun)) {
    signals.push(`platform head noun: "${headNoun}"`);
  }

  if (!signals.length) return { ok: true, signals };
  return {
    ok: false,
    // One reason string rides the funnel counter; the exact evidence rides
    // the rejects detail and the row's qualification provenance.
    reason: countPhrase ? "business_name_count_phrase" : "business_name_platform_noun",
    signals,
  };
}

function distinctMatches(body, marks) {
  return marks.filter((mark) => mark.test(body)).length;
}

/**
 * Issue #700's forum/board/UGC site-class markers, measured at
 * 2_homepage_fetch off the HTML the probe already holds (the #694
 * integration-gap signal pass — zero new network calls).
 *
 * Families (each fires only on strong evidence):
 *   forum_software  — a forum platform fingerprint (XenForo, phpBB, Discourse…)
 *   thread_urls     — ≥3 thread/category-shaped links (…/threads/, viewtopic…)
 *   ugc_login_ui    — login/register chrome beside ≥2 post-count UI words
 *   job_board_ui    — ≥2 strong job-board phrases ("browse jobs", "post a job"…)
 *   count_title     — a count phrase in the page title or h1 ("21,030 Live Jobs…")
 *
 * platform:true requires ≥2 families — one weak family alone never refuses a
 * real business (careers nav on a plumber site, a footer community link).
 *
 * @returns {{platform: boolean, families: string[], signals: string[], measured: boolean}}
 */
function ugcPlatformMarkersFromHomepage({ html = "", title = "", h1 = "" } = {}) {
  const body = String(html || "");
  if (!body) return { platform: false, families: [], signals: [], measured: false };

  const families = [];
  const signals = [];

  if (FORUM_SOFTWARE_MARK.test(body)) {
    families.push("forum_software");
    const m = FORUM_SOFTWARE_MARK.exec(body);
    signals.push(`forum software fingerprint: ${String(m && m[0]).slice(0, 24)}`);
  }

  const threadLinks = (body.match(FORUM_THREAD_URL_MARK) || []).length;
  if (threadLinks >= FORUM_THREAD_URL_MIN) {
    families.push("thread_urls");
    signals.push(`${threadLinks} thread/category links`);
  }

  if (LOGIN_MARK.test(body) && distinctMatches(body, UGC_COUNT_TEXT_MARKS) >= UGC_COUNT_TEXT_MIN) {
    families.push("ugc_login_ui");
    signals.push("login/register chrome beside post-count UI");
  }

  const jobPhraseHits = distinctMatches(body, JOB_BOARD_PHRASES);
  if (jobPhraseHits >= JOB_BOARD_PHRASE_MIN) {
    families.push("job_board_ui");
    signals.push(`${jobPhraseHits} job-board phrases`);
  }

  const headline = `${String(title || "")} ${String(h1 || "")}`;
  const headlineCount = countPhraseIn(headline);
  if (headlineCount) {
    families.push("count_title");
    signals.push(`count phrase in title/h1: "${headlineCount}"`);
  }

  return {
    platform: families.length >= 2,
    families,
    signals,
    measured: true,
  };
}

module.exports = {
  businessNamePlausibility,
  ugcPlatformMarkersFromHomepage,
};
