"use strict";

// FAIL-CLOSED PREVIEW-HOST GUARD
//
// Every site we build for a prospect is published on its own subdomain of
// wss-ai.com ({business}.wss-ai.com) — that is true for BOTH lanes: the
// self-serve SiteForge (a la carte) product and the automated Ghost Agency
// pipeline. Any other host is not a real build.
//
// Why this exists: `preview_url` is a PERSISTED value that ghost re-emits
// verbatim at compose time (it is never recomputed). A prospect row that ever
// captured a stale URL keeps it forever, survives rebuild attempts, and sails
// past every other gate — the business-identity guard deliberately ignores
// *.vercel.app / *.wss-ai.com hostnames, so a bare dead host has no slug to
// mismatch on. That is exactly how a "Signature Landscape" outreach email went
// out pointing at the retired siteforge-app-rocketsites.vercel.app host, which
// was still serving an unrelated donor site (Howie Excavating & Grading).
//
// So: a NON-EMPTY preview URL on a non-approved host is treated as a hard
// error, never silently rewritten. A wrong host almost always means the build
// itself is wrong or missing, and that must be caught, not papered over. An
// EMPTY preview URL is a different, legitimate state (nothing built yet) and is
// left alone for the caller to handle (e.g. build-on-click reveal mode).

// Canonical public domain for every generated site. Sites live at
// {business}.wss-ai.com; the apex itself is also accepted.
const APPROVED_PREVIEW_DOMAIN = "wss-ai.com";

// The LIVE first-party SiteForge host. The full-run lane emits its previews as
// `siteforge-app-seven.vercel.app/try/<slug>/` rather than a per-business
// subdomain, so refusing every *.vercel.app host blocked real, working builds —
// the retired rocketsites deployment is the thing that must never ship, not
// SiteForge itself. Kept as an explicit single-host allowance (not a wildcard)
// so no other .vercel.app deployment is implicitly trusted.
// RETIRED as a prospect-facing surface (owner directive 2026-07-29): the
// /try/ builds are the older V5 lane — the owner opened one from a proof email
// and found ANOTHER COMPANY'S logo (APOC) and a broken layout, while the clean
// wss-ai.com mirror sat deployed and unused. The product a prospect sees is
// their own <slug>.wss-ai.com mirror, full stop. SiteForge keeps serving
// scorecards/reports (report_url is not routed through this guard); it just can
// never again be the preview a prospect is emailed. A prospect with no mirror
// yet holds — a blank is recoverable, a bad first impression is not.
const APPROVED_PREVIEW_HOSTS = new Set([]);

// Explicitly named so diagnostics can say WHY a URL was rejected. The allowlist
// above already excludes these; this is for a clear, greppable reason string.
const RETIRED_PREVIEW_HOSTS = new Set(["siteforge-app-rocketsites.vercel.app"]);

// Suffix-safe host match. Guards against the classic near-miss spoofs:
//   wss-ai.com.evil.com   -> not a subdomain (does not end with ".wss-ai.com")
//   evil-wss-ai.com       -> not a subdomain (the "." prefix is required)
// A single trailing dot (the DNS root form, urban.wss-ai.com.) is normalized
// away so it cannot be used to slip past the check.
function hostMatchesDomain(host, domain) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  const d = String(domain || "").toLowerCase();
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

// Parse strictly. Anything we cannot confidently parse is rejected — the whole
// point is to fail closed. Note URL parsing also neutralizes userinfo tricks
// like https://wss-ai.com@evil.com/ (hostname is evil.com, so it is rejected).
function previewHostOf(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return "";
    return String(parsed.hostname || "").toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

// True only for an https URL on the canonical wss-ai.com domain (or a
// subdomain of it). Empty/garbage/http/foreign-host all return false.
function isApprovedPreviewUrl(url) {
  const host = previewHostOf(url);
  if (!host) return false;
  if (RETIRED_PREVIEW_HOSTS.has(host)) return false;
  if (APPROVED_PREVIEW_HOSTS.has(host)) return true;
  return hostMatchesDomain(host, APPROVED_PREVIEW_DOMAIN);
}

// Human-readable reason for a rejection, for logs and blocked-send payloads.
function previewHostRejection(url) {
  const raw = String(url || "").trim();
  if (!raw) return "preview_url is empty";
  const host = previewHostOf(raw);
  if (!host) return `preview_url is not a parseable https URL: ${raw}`;
  if (RETIRED_PREVIEW_HOSTS.has(host)) {
    return `preview_url points at the RETIRED host ${host} (decommissioned; it serves unrelated donor sites). Rebuild on ${APPROVED_PREVIEW_DOMAIN}.`;
  }
  return `preview_url host ${host} is not an approved site host (expected ${APPROVED_PREVIEW_DOMAIN} or ${[...APPROVED_PREVIEW_HOSTS].join(", ")})`;
}

// Convenience for persistence paths: keep an approved URL, drop anything else.
// Used so a stale non-canonical URL can never be carried forward onto a
// prospect record and re-emailed later.
function sanitizePreviewUrl(url) {
  return isApprovedPreviewUrl(url) ? String(url || "").trim() : "";
}

module.exports = {
  APPROVED_PREVIEW_DOMAIN,
  APPROVED_PREVIEW_HOSTS,
  RETIRED_PREVIEW_HOSTS,
  isApprovedPreviewUrl,
  previewHostOf,
  previewHostRejection,
  sanitizePreviewUrl,
};
