#!/usr/bin/env node
/**
 * Build-time consistency check (no network).
 *
 * Runs against the source tree to catch regressions BEFORE publish:
 *   - every route file in src/routes/ has a matching <loc> in public/sitemap.xml
 *   - every <loc> in sitemap.xml maps to a real route file
 *   - public/robots.txt declares the canonical sitemap URL
 *   - all sitemap URLs and the robots.txt sitemap URL share the same origin
 *   - every <img> in src/routes/**.tsx and src/components/site/**.tsx has
 *     width + height attributes (CLS guard)
 *
 * Usage:  bun run audit:build
 * Exit codes: 0 = clean, 1 = issues found
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { exit } from "node:process";

const ROOT = process.cwd();
const ROUTES_DIR = join(ROOT, "src", "routes");
const SITEMAP = join(ROOT, "public", "sitemap.xml");
const ROBOTS = join(ROOT, "public", "robots.txt");

const c = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

let fails = 0;
let warns = 0;
const log = {
  pass: (m) => console.log(`  ${c.green}✓${c.reset} ${m}`),
  warn: (m) => {
    warns++;
    console.log(`  ${c.yellow}!${c.reset} ${m}`);
  },
  fail: (m) => {
    fails++;
    console.log(`  ${c.red}✗${c.reset} ${m}`);
  },
  section: (n) => console.log(`\n${c.bold}${c.cyan}— ${n}${c.reset}`),
};

/* ─────────── read sources ─────────── */

const sitemapXml = readFileSync(SITEMAP, "utf8");
const robotsTxt = readFileSync(ROBOTS, "utf8");

const sitemapLocs = [...sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(
  (m) => m[1],
);
const sitemapPaths = sitemapLocs.map((u) => new URL(u).pathname);
const sitemapOrigins = new Set(sitemapLocs.map((u) => new URL(u).origin));

const robotsSitemap = robotsTxt.match(/^\s*Sitemap:\s*(\S+)/im)?.[1];

/* ─────────── routes → expected paths ─────────── */

function listRouteFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...listRouteFiles(p));
    } else if (entry.endsWith(".tsx") && !entry.startsWith("__")) {
      out.push(p);
    }
  }
  return out;
}

/** Convert a route file path to its URL pathname (or null if API/dynamic-only). */
function routeFileToPath(file) {
  const rel = relative(ROUTES_DIR, file).replace(/\\/g, "/").replace(/\.tsx$/, "");
  // skip api routes (server endpoints, not crawlable pages)
  if (rel.startsWith("api/") || rel.startsWith("api.")) return null;
  // skip dynamic param routes — they're handled per-instance via sitemap
  if (rel.includes("$")) return null;
  if (rel === "index") return "/";
  // dot-separated nested routes: settings.profile → /settings/profile
  return "/" + rel.replace(/\.index$/, "").replace(/\./g, "/");
}

const routeFiles = listRouteFiles(ROUTES_DIR);
const routePaths = routeFiles.map(routeFileToPath).filter(Boolean);

/* ─────────── checks ─────────── */

log.section("robots.txt ↔ sitemap.xml origin");
if (!robotsSitemap) {
  log.fail("robots.txt has no `Sitemap:` directive");
} else {
  const robotsOrigin = new URL(robotsSitemap).origin;
  if (sitemapOrigins.size === 1 && sitemapOrigins.has(robotsOrigin)) {
    log.pass(`Same origin: ${robotsOrigin}`);
  } else {
    log.fail(
      `Origin mismatch — robots.txt says ${robotsOrigin}, sitemap.xml uses ${[...sitemapOrigins].join(", ")}`,
    );
  }
}

log.section("Routes ↔ sitemap");
for (const p of routePaths) {
  if (sitemapPaths.includes(p)) {
    log.pass(`Route ${p} listed in sitemap`);
  } else {
    log.fail(`Route ${p} exists in src/routes/ but is missing from sitemap.xml`);
  }
}
for (const p of sitemapPaths) {
  // dynamic service slugs are individually listed but the route file is services.$slug.tsx
  const isDynamicChild = /^\/services\/[^/]+$/.test(p);
  if (!routePaths.includes(p) && !isDynamicChild && p !== "/") {
    log.warn(`Sitemap lists ${p} but no matching static route file found`);
  }
}

log.section("<img> dimensions in source (CLS guard)");
const SRC_GLOBS = [join(ROOT, "src", "routes"), join(ROOT, "src", "components")];
function listTsx(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listTsx(p));
    else if (/\.tsx$/.test(entry)) out.push(p);
  }
  return out;
}
const tsxFiles = SRC_GLOBS.flatMap(listTsx);
let imgTotal = 0;
let imgMissing = 0;
for (const file of tsxFiles) {
  const code = readFileSync(file, "utf8");
  // crude but effective: find each <img ...> opening tag
  const imgs = [...code.matchAll(/<img\b([^>]*?)\/?>/gs)];
  for (const m of imgs) {
    imgTotal++;
    const attrs = m[1];
    const hasW = /\bwidth\s*=/.test(attrs);
    const hasH = /\bheight\s*=/.test(attrs);
    const hasAlt = /\balt\s*=/.test(attrs);
    if (!hasW || !hasH) {
      imgMissing++;
      log.warn(
        `${relative(ROOT, file)} — <img> missing ${!hasW ? "width" : ""}${!hasW && !hasH ? "/" : ""}${!hasH ? "height" : ""}`,
      );
    }
    if (!hasAlt) {
      log.warn(`${relative(ROOT, file)} — <img> missing alt attribute`);
    }
  }
}
if (imgTotal > 0 && imgMissing === 0) {
  log.pass(`${imgTotal} <img> tags all declare width + height`);
}

/* ─────────── summary ─────────── */

console.log(
  `\n${c.bold}Summary${c.reset}  ${c.yellow}${warns} warnings${c.reset}  ${c.red}${fails} failures${c.reset}`,
);
if (fails > 0) {
  console.log(`${c.red}${c.bold}Build-time audit failed.${c.reset}`);
  exit(1);
}
console.log(`${c.green}${c.bold}Build-time audit clean.${c.reset}`);
exit(0);
