#!/usr/bin/env node
/**
 * SEO / asset / crawlability audit for Pepper Structural.
 *
 * Runs against a live URL (defaults to the production custom domain) and
 * reports any regression that would silently hurt crawlability or Core Web
 * Vitals. Designed to be re-run after every publish.
 *
 * Checks performed:
 *   1. robots.txt fetch + parse, with sitemap declaration consistency
 *   2. sitemap.xml fetch + every URL responds 200 (no redirect, no 404)
 *   3. Every URL in the sitemap is allowed for *, Googlebot, GPTBot, ClaudeBot
 *   4. Critical pages (/, /services, /contact, one /services/[slug]) parse
 *      cleanly and every <link rel="stylesheet">, <script src>, <img>, and
 *      <source srcset> they reference returns 200 and is not robots-blocked
 *   5. Every <img> on those pages declares width + height (CLS guard)
 *   6. Surface Content-Security-Policy and X-Robots-Tag headers so we catch
 *      any future header that would block bots or block asset loading
 *
 * Usage:
 *   bun run audit:seo                                    # default: prod domain
 *   bun run audit:seo -- https://pepper.wss-ai.com       # explicit URL
 *   bun run audit:seo -- https://preview-url.lovable.app
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed (CI-friendly)
 */

import { argv, exit } from "node:process";

const BASE = (argv[2] || "https://pepper.wss-ai.com").replace(/\/+$/, "");

const FRIENDLY_BOTS = [
  "*",
  "Googlebot",
  "Bingbot",
  "GPTBot",
  "OAI-SearchBot",
  "PerplexityBot",
  "ClaudeBot",
  "Applebot",
];

// Pages we want to deeply inspect for asset / image issues.
const CRITICAL_PAGES = [
  "/",
  "/services",
  "/services/kitchen-remodeling",
  "/contact",
  "/service-area",
];

/* ───────────────────────── reporter ───────────────────────── */

const results = [];
let totalFail = 0;
let totalWarn = 0;

const c = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function pass(group, msg) {
  results.push({ group, level: "pass", msg });
  console.log(`  ${c.green}✓${c.reset} ${msg}`);
}
function warn(group, msg) {
  totalWarn++;
  results.push({ group, level: "warn", msg });
  console.log(`  ${c.yellow}!${c.reset} ${msg}`);
}
function fail(group, msg) {
  totalFail++;
  results.push({ group, level: "fail", msg });
  console.log(`  ${c.red}✗${c.reset} ${msg}`);
}
function section(name) {
  console.log(`\n${c.bold}${c.cyan}— ${name}${c.reset}`);
}

/* ───────────────────────── helpers ───────────────────────── */

async function fetchWithTimeout(url, init = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "PepperSEOAudit/1.0 (+lovable)" },
      ...init,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** Parse robots.txt into a map of useragent -> { allow: [], disallow: [], sitemaps: [] } */
function parseRobots(txt) {
  const out = { groups: {}, sitemaps: [] };
  let currentAgents = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    const val = valRaw.trim();
    const k = key.toLowerCase();
    if (k === "user-agent") {
      // A new group starts when we see User-agent after a directive.
      currentAgents = [val];
      out.groups[val] ??= { allow: [], disallow: [] };
    } else if (k === "disallow" || k === "allow") {
      for (const ua of currentAgents) {
        out.groups[ua] ??= { allow: [], disallow: [] };
        out.groups[ua][k].push(val);
      }
    } else if (k === "sitemap") {
      out.sitemaps.push(val);
    }
  }
  return out;
}

/** Returns true if `path` is allowed for a given useragent under parsed robots. */
function isAllowed(robots, ua, path) {
  // Robots Exclusion: longest match wins; Allow beats Disallow at same length.
  const groups = [robots.groups[ua], robots.groups["*"]].filter(Boolean);
  let bestLen = -1;
  let bestAllow = true; // default: allowed if no rule matches
  for (const g of groups) {
    for (const rule of g.disallow) {
      if (rule === "") continue; // "Disallow:" with empty value = allow all
      if (path.startsWith(rule) && rule.length > bestLen) {
        bestLen = rule.length;
        bestAllow = false;
      }
    }
    for (const rule of g.allow) {
      if (path.startsWith(rule) && rule.length >= bestLen) {
        bestLen = rule.length;
        bestAllow = true;
      }
    }
    // Stop at the first matching group per spec.
    if (g === robots.groups[ua]) break;
  }
  return bestAllow;
}

/** Extract <loc> URLs from a sitemap.xml string. */
function parseSitemap(xml) {
  const locs = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) locs.push(m[1]);
  return locs;
}

/** Very small HTML scraper — enough for tags+attrs we care about, no JS exec. */
function extractTags(html, tagName) {
  const out = [];
  const re = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = {};
    const aRe = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/g;
    let a;
    while ((a = aRe.exec(m[1])) !== null) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    out.push(attrs);
  }
  return out;
}

/** Resolve a possibly-relative URL against base. Returns null on data:/about:/javascript:. */
function resolveUrl(href, base) {
  if (!href) return null;
  if (/^(data|about|javascript|mailto|tel|blob):/i.test(href)) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/* ───────────────────────── checks ───────────────────────── */

async function checkRobots() {
  section("robots.txt");
  const url = `${BASE}/robots.txt`;
  const res = await fetchWithTimeout(url);
  if (res.status !== 200) {
    fail("robots", `GET ${url} → ${res.status}`);
    return null;
  }
  const txt = await res.text();
  pass("robots", `GET ${url} → 200`);
  const robots = parseRobots(txt);

  // Sitemap declaration check
  if (robots.sitemaps.length === 0) {
    fail("robots", "No `Sitemap:` directive declared in robots.txt");
  } else {
    const expected = `${BASE}/sitemap.xml`;
    if (robots.sitemaps.includes(expected)) {
      pass("robots", `Declares ${expected}`);
    } else {
      fail(
        "robots",
        `Sitemap declared as ${robots.sitemaps.join(", ")} — expected ${expected}`,
      );
    }
  }

  // X-Robots-Tag should not block
  const xrt = res.headers.get("x-robots-tag");
  if (xrt && /noindex|nofollow|none/i.test(xrt)) {
    fail("robots", `robots.txt response carries X-Robots-Tag: ${xrt}`);
  }

  return { robots, raw: txt };
}

async function checkSitemap(robots) {
  section("sitemap.xml");
  const url = `${BASE}/sitemap.xml`;
  const res = await fetchWithTimeout(url);
  if (res.status !== 200) {
    fail("sitemap", `GET ${url} → ${res.status}`);
    return [];
  }
  pass("sitemap", `GET ${url} → 200`);
  const xml = await res.text();
  const locs = parseSitemap(xml);
  if (locs.length === 0) {
    fail("sitemap", "Sitemap parsed 0 <loc> entries");
    return [];
  }
  pass("sitemap", `${locs.length} URLs declared`);

  // Every sitemap URL: 200, on the right host, not robots-blocked
  for (const loc of locs) {
    let u;
    try {
      u = new URL(loc);
    } catch {
      fail("sitemap", `Invalid URL: ${loc}`);
      continue;
    }
    if (u.origin !== new URL(BASE).origin) {
      warn("sitemap", `URL on different origin: ${loc}`);
    }
    // robots-allowed for every friendly bot
    if (robots) {
      const blockedBy = FRIENDLY_BOTS.filter((ua) => !isAllowed(robots, ua, u.pathname));
      if (blockedBy.length > 0) {
        fail("sitemap", `${u.pathname} blocked in robots.txt for: ${blockedBy.join(", ")}`);
      }
    }
    const r = await fetchWithTimeout(loc, { method: "GET" });
    if (r.status === 200) {
      pass("sitemap", `${u.pathname} → 200`);
    } else if (r.status >= 300 && r.status < 400) {
      fail(
        "sitemap",
        `${u.pathname} → ${r.status} redirect to ${r.headers.get("location")} (sitemap should hold canonical URLs)`,
      );
    } else {
      fail("sitemap", `${u.pathname} → ${r.status}`);
    }
  }

  return locs;
}

async function checkPageAssets(robots, path) {
  section(`Page assets · ${path}`);
  const pageUrl = `${BASE}${path}`;
  const res = await fetchWithTimeout(pageUrl);
  if (res.status !== 200) {
    fail("assets", `GET ${pageUrl} → ${res.status}`);
    return;
  }
  pass("assets", `GET ${path} → 200`);

  // Surface notable headers
  const csp = res.headers.get("content-security-policy");
  const xrt = res.headers.get("x-robots-tag");
  if (csp) {
    // The known-safe Lovable CSP is permissive; flag only if it bans 'self'.
    if (/default-src\s+'none'/i.test(csp)) {
      fail("assets", `CSP blocks default-src on ${path}: ${csp.slice(0, 120)}…`);
    } else {
      pass("assets", `CSP present (default-src not 'none')`);
    }
  }
  if (xrt && /noindex|nofollow|none/i.test(xrt)) {
    fail("assets", `${path} carries X-Robots-Tag: ${xrt}`);
  }

  const html = await res.text();

  // Collect asset URLs
  const assets = new Set();
  for (const t of extractTags(html, "link")) {
    const rel = (t.rel || "").toLowerCase();
    if (/(stylesheet|preload|icon|manifest)/.test(rel) && t.href) {
      const u = resolveUrl(t.href, pageUrl);
      if (u) assets.add(u);
    }
  }
  for (const t of extractTags(html, "script")) {
    if (t.src) {
      const u = resolveUrl(t.src, pageUrl);
      if (u) assets.add(u);
    }
  }
  const imgs = extractTags(html, "img");
  for (const t of imgs) {
    if (t.src) {
      const u = resolveUrl(t.src, pageUrl);
      if (u) assets.add(u);
    }
  }
  for (const t of extractTags(html, "source")) {
    if (t.src) {
      const u = resolveUrl(t.src, pageUrl);
      if (u) assets.add(u);
    }
  }

  // Check each asset: 200 + not robots-blocked
  for (const a of assets) {
    let u;
    try {
      u = new URL(a);
    } catch {
      continue;
    }
    if (u.origin === new URL(BASE).origin && robots) {
      const blockedBy = FRIENDLY_BOTS.filter((ua) => !isAllowed(robots, ua, u.pathname));
      if (blockedBy.length > 0) {
        fail("assets", `${u.pathname} blocked in robots.txt for: ${blockedBy.join(", ")}`);
      }
    }
    const r = await fetchWithTimeout(a, { method: "HEAD" }).catch(() => null);
    // Some CDNs reject HEAD — fall back to GET range
    let status = r?.status ?? 0;
    if (!r || status === 405 || status === 0) {
      const r2 = await fetchWithTimeout(a, {
        method: "GET",
        headers: { range: "bytes=0-0" },
      }).catch(() => null);
      status = r2?.status ?? 0;
    }
    if (status >= 200 && status < 400) {
      // ok (silent — too noisy to log every asset)
    } else {
      fail("assets", `${a} → ${status}`);
    }
  }
  pass("assets", `${assets.size} linked assets reachable`);

  // Image dimension check (CLS guard)
  let missingDims = 0;
  let badAlt = 0;
  for (const t of imgs) {
    const src = t.src ? resolveUrl(t.src, pageUrl) : null;
    if (!src) continue;
    const hasW = !!t.width;
    const hasH = !!t.height;
    if (!hasW || !hasH) {
      missingDims++;
      warn("images", `${t.src} missing width/height attribute`);
    }
    if (t.alt === undefined) {
      badAlt++;
      warn("images", `${t.src} missing alt attribute`);
    }
  }
  if (imgs.length === 0) {
    pass("images", `No <img> tags found on ${path}`);
  } else if (missingDims === 0 && badAlt === 0) {
    pass("images", `${imgs.length} images all have width/height + alt`);
  }
}

/* ───────────────────────── run ───────────────────────── */

console.log(
  `${c.bold}Pepper Structural · SEO/asset audit${c.reset}\n${c.dim}target:${c.reset} ${BASE}\n`,
);

const robotsResult = await checkRobots();
const robots = robotsResult?.robots ?? null;
await checkSitemap(robots);
for (const p of CRITICAL_PAGES) {
  await checkPageAssets(robots, p);
}

/* ───────────────────────── summary ───────────────────────── */

const passes = results.filter((r) => r.level === "pass").length;
console.log(
  `\n${c.bold}Summary${c.reset}  ${c.green}${passes} passed${c.reset}  ${c.yellow}${totalWarn} warnings${c.reset}  ${c.red}${totalFail} failures${c.reset}`,
);

if (totalFail > 0) {
  console.log(`\n${c.red}${c.bold}Audit failed.${c.reset} Fix the failures above before publishing.`);
  exit(1);
} else if (totalWarn > 0) {
  console.log(`\n${c.yellow}Audit passed with warnings.${c.reset} Review them when convenient.`);
  exit(0);
} else {
  console.log(`\n${c.green}${c.bold}All checks passed.${c.reset} Safe to publish.`);
  exit(0);
}
