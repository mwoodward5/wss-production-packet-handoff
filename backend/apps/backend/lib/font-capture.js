"use strict";

// lib/font-capture.js — the client's TYPEFACE, read from their own site.
//
// Owner, twice: "the font should match accordingly" / "The font isn't matching
// what their old font is." A mirror wearing their logo and their colours but
// the donor's serif still reads as a template. RiverCity is the exact case:
// their site sets Anton for display and Inter for body; the donor ships
// Fraunces + Inter, so the body already matched and only the headline face was
// foreign — which is precisely the part a person notices.
//
// WHERE THE ANSWER LIVES. A site that uses webfonts nearly always LINKS them,
// and the link names the families outright:
//   <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800">
// That is better evidence than scraping computed styles: it is unambiguous, it
// survives minification, and it hands us a hosted source we are entitled to
// serve. Their own stylesheets are read as a fallback for the self-hosted case.
//
// WHICH IS THE HEADLINE FACE. Display faces ship as one weight (Anton); body
// faces ship as a range (Inter 400..800), because body text needs regular and
// bold and the headline does not. So the family requesting the FEWEST weights
// is the display face and the widest range is the body face. With a single
// family, it does both jobs.
//
// TRUTH LAW: a font we cannot identify is not guessed. No detection means the
// donor's own typography stays, which is a considered design rather than a
// wrong one.

const GOOGLE_CSS = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s>]+/gi;

/** Families a Google Fonts css2 URL asks for, with the weights each requested. */
function familiesFromGoogleUrl(href) {
  const out = [];
  let url;
  try { url = new URL(String(href).replace(/&amp;/g, "&")); } catch { return out; }
  for (const raw of url.searchParams.getAll("family")) {
    // "Inter:wght@400;500;600;700;800" | "Anton" | "Open Sans:ital,wght@0,400"
    const [nameRaw, spec = ""] = String(raw).split(":");
    const name = nameRaw.replace(/\+/g, " ").trim();
    if (!name) continue;
    const weights = [...spec.matchAll(/(\d{3})/g)].map((m) => Number(m[1]));
    out.push({ name, weights: [...new Set(weights)] });
  }
  return out;
}

/** Quoted family names from raw CSS, minus var() indirection and generics. */
const GENERIC = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial", "unset",
]);

function familiesFromCss(cssText) {
  const out = [];
  for (const m of String(cssText || "").matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = String(m[1]).split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (!first || first.startsWith("var(") || GENERIC.has(first.toLowerCase())) continue;
    out.push(first);
  }
  return [...new Set(out)];
}

/**
 * chooseRoles(families) -> { display, body }
 * Fewest requested weights = the headline face; widest range = body.
 */
function chooseRoles(families = []) {
  const named = families.filter((f) => f && f.name);
  if (!named.length) return { display: "", body: "" };
  if (named.length === 1) return { display: named[0].name, body: named[0].name };
  const sorted = [...named].sort((a, b) => (a.weights.length || 1) - (b.weights.length || 1));
  return { display: sorted[0].name, body: sorted[sorted.length - 1].name };
}

/** The css2 href that serves exactly the families we chose. */
function googleHrefFor({ display, body }) {
  const names = [...new Set([display, body].filter(Boolean))];
  if (!names.length) return "";
  const params = names.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, "+")}:wght@400;600;700;800`);
  return `https://fonts.googleapis.com/css2?${params.join("&")}&display=swap`;
}

/**
 * captureFonts(websiteUrl, { fetchImpl }) ->
 *   { ok, display, body, href, source, reason }
 *
 * Only reports a font it can actually name AND serve. Anything else returns
 * ok:false so the caller leaves the donor's typography alone.
 */
async function captureFonts(websiteUrl, { fetchImpl = fetch, maxCss = 3 } = {}) {
  const site = String(websiteUrl || "").trim();
  if (!/^https?:\/\//i.test(site)) return { ok: false, reason: "no_website" };

  let html = "";
  try {
    const res = await fetchImpl(site, { redirect: "follow" });
    if (!res || !res.ok) return { ok: false, reason: `site_unreachable_${res && res.status}` };
    html = await res.text();
  } catch (e) {
    return { ok: false, reason: `site_fetch_failed: ${String((e && e.message) || e).slice(0, 80)}` };
  }

  // 1. The Google Fonts link — the family names in plain text.
  const googleHrefs = [...new Set(String(html).match(GOOGLE_CSS) || [])];
  const families = [];
  for (const href of googleHrefs) families.push(...familiesFromGoogleUrl(href));

  if (families.length) {
    const roles = chooseRoles(families);
    return {
      ok: Boolean(roles.display || roles.body),
      display: roles.display,
      body: roles.body,
      href: googleHrefFor(roles),
      source: googleHrefs[0],
      provider: "google",
    };
  }

  // 2. Self-hosted: read their own stylesheets and take the names they declare.
  const sheets = [...String(html).matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi)]
    .map((m) => m[1])
    .filter((h) => !/fonts\.googleapis|fonts\.gstatic/i.test(h))
    .slice(0, maxCss);
  const declared = [];
  for (const sheet of sheets) {
    let url;
    try { url = new URL(sheet, site).toString(); } catch { continue; }
    try {
      const res = await fetchImpl(url);
      if (!res || !res.ok) continue;
      declared.push(...familiesFromCss(await res.text()));
    } catch { /* a sheet we cannot read simply contributes nothing */ }
  }
  const unique = [...new Set(declared)];
  if (!unique.length) return { ok: false, reason: "no_font_declared" };

  // Self-hosted faces are named but not necessarily servable by us. Only claim
  // the ones Google can serve; otherwise the mirror would ask for a family the
  // browser has never heard of and silently fall back to a system face.
  const roles = { display: unique[0], body: unique[1] || unique[0] };
  return {
    ok: true,
    display: roles.display,
    body: roles.body,
    href: googleHrefFor(roles),
    source: site,
    provider: "declared",
  };
}

module.exports = { captureFonts, familiesFromGoogleUrl, familiesFromCss, chooseRoles, googleHrefFor };
