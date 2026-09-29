"use strict";

// lib/customer-site.js — the two facts the customer dashboard was missing.
//
// WHY THIS FILE EXISTS.
//
// wss-ai.com/dashboard is the page a $149/mo customer opens. Measured 2026-08-08
// against production it had three interactive elements — Sign out, a hardcoded
// link to connect.wss-labs.com, and a tel: link — and it rendered the literal
// string "Your managed site" from `<div id="sitename">` that no line of its own
// JavaScript ever assigns to. There was NO WAY TO REACH THE WEBSITE THEY PAY FOR
// from the dashboard about that website.
//
// The URL was never missing. Of the 116 non-archived prospect rows, 55 carry a
// usable https preview URL, the top-level `preview_url` column disagreed with
// `record.preview_url` on 0 of 1251 rows, and 30 of the 30 most recent stored
// URLs answer HTTP 200. The one account that can log in today
// (ghost_agency_dashboard_access, 1 row, Poor John's Plumbing) carries
// https://wss-test-poor-john-s-plumbing-parkville.wss-ai.com/ → 200. One field,
// never rendered.
//
// The GETFOUND card said "No scored reports on file yet" for that same account
// while we hold a readable B / 83 report for it. That card asks
// /api/connect/visibility, which reads CallPrep's `scan_history` — a table with
// zero rows for every business we checked. The sentence was true about
// scan_history and false about the business. A TREND needs two scans and we have
// none; a GRADE needs one report and we have it. This module supplies the grade.
//
// WHERE THE GRADE COMES FROM, AND WHERE IT NEVER COMES FROM. It is read from the
// report itself via lib/report-grade.js — the same JSON the customer's browser
// fetches when they click through — and never from our own database copy. The
// two scorers disagree on 8 of 8 measured scores and 7 of 8 letters (the table
// is in lib/report-grade.js). A dashboard that prints C+ over a page that says B
// is a lie the reader catches with one click. If the report cannot be read there
// is NO FALLBACK GRADE: this module returns `available: false` with a reason and
// the card says so.

const { clientReferenceCode } = require("./client-reference");
const { fetchReportFacts, REPORT_CATEGORY_KEYS, REPORT_CATEGORY_LABEL } = require("./report-grade");
const { safeReportUrl } = require("./report-url");

const MIRROR_HOST_SUFFIX = ".wss-ai.com";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const PROSPECT_JOB_PREFIX = "prospect-";

/** How many low-scoring areas the card names. Three fits one line on mobile. */
const WEAKEST_LIMIT = 3;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * readRows(result) -> { ok, rows }
 *
 * A FAILED READ IS NOT AN EMPTY TABLE, and collapsing the two is how this
 * module shipped its first bug. The select list below originally asked for a
 * `reference` column that ghost_agency_prospects does not have; PostgREST
 * answered 42703 "column does not exist", lib/store.js returned
 * `mode: "live_select_failed"` with no rows, and a caller that only looked for
 * an array told the customer "Your website isn't on file here yet" about a site
 * that was live and answering 200. Every test passed and the deploy was READY.
 *
 * So the mode is checked, not just the shape: anything that is not a completed
 * live read — a failure, a dry run against an unconfigured store — is `ok:
 * false`, and the surface says it could not load rather than that there is
 * nothing there. Bare arrays are accepted so a test stub stays trivial.
 */
function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  const mode = result && result.mode;
  if (mode && mode !== "live_select") return { ok: false, rows: [] };
  if (Array.isArray(result && result.data)) return { ok: true, rows: result.data };
  if (Array.isArray(result && result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [] };
}

/** "https://wss-test-foo.wss-ai.com/contact" -> "wss-test-foo", else "". */
function mirrorHostSlug(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let host;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host.endsWith(MIRROR_HOST_SUFFIX)) return "";
  return host.slice(0, -MIRROR_HOST_SUFFIX.length).split(".").pop() || "";
}

/**
 * The customer's live site URL, https only.
 *
 * READ ORDER IS THE MEASURED ONE. `preview_url` is a real top-level column and
 * it never contradicted `record.preview_url` across all 1251 rows, so the column
 * leads. The two record paths are pure coverage: `record.preview_url` carries 138
 * rows and `record.build_dispatch.preview_url` another 89, and between them the
 * union is 214 rows versus the column's 196.
 *
 * http:// is refused rather than upgraded. We are handing a customer a link to
 * their own product; guessing at a scheme is not a fact we have.
 */
function siteUrlFromRow(row) {
  const source = plainObject(row) || {};
  const record = plainObject(source.record) || {};
  const dispatch = plainObject(record.build_dispatch) || {};
  const candidates = [source.preview_url, record.preview_url, dispatch.preview_url];
  for (const candidate of candidates) {
    const raw = String(candidate == null ? "" : candidate).trim();
    if (!raw || raw.length > 2048) continue;
    let url;
    try { url = new URL(raw); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    return url.toString();
  }
  return "";
}

/** The hostname we print, minus a leading www. */
function siteHost(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The report link, or "" — never a dead one. safeReportUrl is structural on
 * purpose: CallPrep is a single page app that answers 200 for every /report/*
 * path, so HTTP status cannot tell a real report from a typo. 17 of the 43
 * stored report links are `siteforge-app-rocketsites.vercel.app/try/<slug>/
 * scorecard.json` — a build artefact on a retired host — and they are refused
 * here before they can become a button.
 */
function reportUrlFromRow(row) {
  const source = plainObject(row) || {};
  const record = plainObject(source.record) || {};
  return safeReportUrl(source.report_url) || safeReportUrl(record.report_url);
}

/** The code the customer reads back to Riley. Registered value wins over derived. */
function clientIdFromRow(row) {
  const source = plainObject(row) || {};
  const record = plainObject(source.record) || {};
  const registered = String(source.reference || record.reference || "").trim();
  return registered || clientReferenceCode(source) || "";
}

/**
 * weakestCategories(facts, limit) -> [{ key, label, grade, score }]
 *
 * The lowest-scoring cards the report actually rendered, ascending. Ties break
 * on REPORT_CATEGORY_KEYS order so the same report always names the same areas
 * in the same order — a card that reshuffles between two loads reads like noise.
 *
 * Only categories the report SCORED are eligible: lib/report-grade.js has
 * already dropped every card the page blanks as "NOT CAPTURED IN THIS REPORT
 * VERSION", so nothing here can name an area the customer's own report does not
 * show. 15 of 20 live reports carry 8 categories and 5 carry exactly one, so a
 * caller must be able to render a list of one.
 */
function weakestCategories(facts, limit = WEAKEST_LIMIT) {
  const categories = plainObject(facts && facts.categories) || {};
  const order = new Map(REPORT_CATEGORY_KEYS.map((key, index) => [key, index]));
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.trunc(Number(limit)) : WEAKEST_LIMIT;
  return Object.keys(categories)
    .filter((key) => order.has(key) && plainObject(categories[key]))
    .map((key) => ({
      key,
      label: REPORT_CATEGORY_LABEL[key],
      grade: String(categories[key].grade || ""),
      score: Number(categories[key].score),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => (a.score - b.score) || (order.get(a.key) - order.get(b.key)))
    .slice(0, cap);
}

/**
 * findAccessRow — the login's own row, looked up by the slug its token is bound
 * to. A paid checkout row (lib/fulfillment.js) and a prospect row
 * (lib/wss-connect-assets/magic-link.js, job_id "prospect-<id>") can both carry
 * a slug; a paid row wins so a business that later buys sees its customer
 * identity rather than the prospect shell it came from.
 */
async function findAccessRow(slug, select) {
  const { rows } = readRows(await select(
    "ghost_agency_dashboard_access",
    `select=job_id,owner_email,business_name,site_slug,visibility_business&site_slug=eq.${encodeURIComponent(slug)}&limit=5`,
  ));
  const paid = rows.filter((row) => !String(row && row.job_id || "").startsWith(PROSPECT_JOB_PREFIX));
  return paid[0] || rows[0] || null;
}

/**
 * The columns ghost_agency_prospects actually has. `reference` is deliberately
 * NOT here: it exists on the site-edit lookup path as `record.reference` inside
 * the jsonb, never as a column, and asking for it 400s the whole query
 * (verified against production 2026-08-08, PostgREST 42703). Anything added to
 * this list must exist on the table or every customer loses their site card.
 */
const PROSPECT_COLUMNS = "prospect_id,business_name,preview_url,report_url,record";

/**
 * findSiteRow — the prospect row whose preview host IS this slug.
 *
 * TWO LOOKUPS, IN THIS ORDER, AND THE SECOND IS NOT REDUNDANT. The host match is
 * primary because the slug is by definition the first label of the preview host
 * (lib/wss-connect-assets/magic-link.js prospectSiteSlug derives it that way).
 * The `prospect_id` fallback exists for a row whose preview URL has since been
 * cleared or rewritten: the job id is namespaced `prospect-<prospect_id>`, so the
 * identity survives even when the URL does not. Both resolve the one live
 * account today (verified against production 2026-08-08).
 *
 * AMBIGUITY REFUSES. Two rows claiming one host is the wrong-client hazard —
 * showing a customer somebody else's website is worse than showing them none —
 * so the caller gets no site rather than a coin flip.
 */
async function findSiteRow({ slug, jobId, select }) {
  const byHost = readRows(await select(
    "ghost_agency_prospects",
    `select=${PROSPECT_COLUMNS}&preview_url=ilike.*${encodeURIComponent(slug)}*&limit=25`,
  ));
  if (!byHost.ok) return { row: null, reason: "lookup_failed" };
  const exact = byHost.rows.filter((row) => mirrorHostSlug(row && row.preview_url) === slug);
  if (exact.length === 1) return { row: exact[0], reason: "" };
  if (exact.length > 1) return { row: null, reason: "multiple_sites_claim_this_login" };

  const id = String(jobId || "").trim();
  if (!id.startsWith(PROSPECT_JOB_PREFIX)) return { row: null, reason: "" };
  const prospectId = id.slice(PROSPECT_JOB_PREFIX.length);
  if (!prospectId) return { row: null, reason: "" };
  const byId = readRows(await select(
    "ghost_agency_prospects",
    `select=${PROSPECT_COLUMNS}&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=5`,
  ));
  if (!byId.ok) return { row: null, reason: "lookup_failed" };
  return { row: byId.rows.length === 1 ? byId.rows[0] : null, reason: "" };
}

/**
 * resolveCustomerSurface({ siteSlug, select, fetchReport, env }) -> surface
 *
 * surface = {
 *   businessName, clientId,
 *   site:   { available, url, host, reason },
 *   report: { available, url, grade, score, scored, weakest, reason },
 * }
 *
 * NEVER THROWS. A store that is down, a slug with no row, a report that times
 * out — every one of them comes back as `available: false` with a reason, and
 * the page says the true thing about an empty state instead of rendering a dead
 * link or a grade nobody measured.
 *
 * `siteSlug` MUST come from the caller's own token, never from the query string,
 * for the same reason api/connect/visibility.js re-derives the business
 * server-side: a slug taken from the browser lets one customer read another's.
 */
async function resolveCustomerSurface({
  siteSlug = "",
  select,
  fetchReport = fetchReportFacts,
  env = process.env,
} = {}) {
  const surface = {
    businessName: "",
    clientId: "",
    site: { available: false, url: "", host: "", reason: "no_site_on_file" },
    report: { available: false, url: "", grade: "", score: null, scored: 0, weakest: [], reason: "no_report_on_file" },
  };

  const slug = String(siteSlug || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug) || typeof select !== "function") {
    surface.site.reason = "no_site_bound_to_this_login";
    surface.report.reason = "no_site_bound_to_this_login";
    return surface;
  }

  let access = null;
  try { access = await findAccessRow(slug, select); } catch { access = null; }
  if (access && access.business_name) surface.businessName = String(access.business_name).trim();

  let found = { row: null, reason: "" };
  try {
    found = await findSiteRow({ slug, jobId: access && access.job_id, select });
  } catch {
    surface.site.reason = "lookup_failed";
    surface.report.reason = "lookup_failed";
    return surface;
  }
  if (found.reason) {
    surface.site.reason = found.reason;
    surface.report.reason = found.reason;
    return surface;
  }
  const row = found.row;
  if (!row) return surface;

  if (!surface.businessName && row.business_name) surface.businessName = String(row.business_name).trim();
  surface.clientId = clientIdFromRow(row);

  const url = siteUrlFromRow(row);
  if (url) surface.site = { available: true, url, host: siteHost(url), reason: "" };

  const reportUrl = reportUrlFromRow(row);
  if (!reportUrl) return surface;

  // The link is real whether or not the grade reads, so it is returned either
  // way — a customer who wants to look at their own report should not be
  // blocked by our four-second budget.
  surface.report.url = reportUrl;
  let facts = null;
  try {
    facts = await fetchReport({ reportUrl, env });
  } catch {
    facts = null;
  }
  if (!facts || facts.ok !== true || !plainObject(facts.facts)) {
    // THE ONLY BRANCH THAT COULD LIE, AND IT DOES NOT. No grade is invented
    // here, no database copy is consulted, no letter is derived from a score we
    // did not read. The reason travels to the page so the card can say the
    // accurate true thing — "nothing scored yet" is a different sentence from
    // "we could not reach it".
    surface.report.reason = String((facts && facts.reason) || "report_unreadable") || "report_unreadable";
    return surface;
  }

  surface.report = {
    available: true,
    url: reportUrl,
    grade: facts.facts.grade,
    score: facts.facts.score,
    scored: Object.keys(plainObject(facts.facts.categories) || {}).length,
    weakest: weakestCategories(facts.facts),
    reason: "",
  };
  return surface;
}

module.exports = {
  MIRROR_HOST_SUFFIX,
  PROSPECT_COLUMNS,
  WEAKEST_LIMIT,
  clientIdFromRow,
  mirrorHostSlug,
  reportUrlFromRow,
  resolveCustomerSurface,
  siteHost,
  siteUrlFromRow,
  weakestCategories,
};
