#!/usr/bin/env node
// Export the public SiteForge surfaces to a static bundle for Vercel.
// Boots the server in-process, crawls the public routes, rewrites the try-on
// widget into a beta CTA (static hosting has no forge runner), copies theme,
// scripts, demo sites, and meta files into web/dist.
//   node app/scripts/export-static.mjs [outDir]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SITEFORGE_NO_LISTEN = "1";
process.env.NODE_ENV = "production";
process.env.SITEFORGE_DATA_DIR ??= path.join(APP_ROOT, "data");
const { server } = await import("../server.mjs");
const { HERO_FAMILIES } = await import("../lib/engine-adapter.mjs");
const TemplateLib = await import("../lib/template-library.mjs");

await new Promise((ok) => server.listen(0, ok));
const BASE = `http://localhost:${server.address().port}`;
const OUT = path.resolve(process.argv[2] || path.join(APP_ROOT, "..", "web", "dist"));
mkdirSync(OUT, { recursive: true });

const ROUTES = [...new Set(["/", "/pricing", "/support", "/legal/privacy", "/legal/terms", "/legal/accessibility",
  ...HERO_FAMILIES.map((f) => `/templates/${f.key}`), ...TemplateLib.sitemapUrls(TemplateLib.loadTemplateLibrary([]))])];
const FILES = ["/theme.css", "/app.js", "/favicon.svg", "/robots.txt", "/llms.txt", "/sitemap.xml", "/humans.txt", "/manifest.webmanifest", "/og.png"];

const BETA_NOTE = `<div class="notice warn" style="margin-top:.6rem"><b>The live forge runs in the WSS Launch app.</b> This is the public preview site — email <a href="mailto:hello@woodwardsoftware.com?subject=WSS%20Launch%20beta">hello@woodwardsoftware.com</a> for beta access and we'll forge your preview same-day.</div>`;

function staticize(html) {
  return html
    // try-on forms → beta CTA (no runner behind static hosting)
    .replace(/<form id="try-form">[\s\S]*?<\/form>/g, BETA_NOTE)
    .replace(/<form id="intake-genie-form"[\s\S]*?<\/form>/g, BETA_NOTE)
    .replace(/<form data-template-try[\s\S]*?<\/form>/g, BETA_NOTE)
    .replace(/<div id="try-result"[^>]*><\/div>/g, "")
    // auth/app links → beta mailto
    .replace(/href="\/new"/g, 'href="mailto:hello@woodwardsoftware.com?subject=WSS%20Launch%20beta"')
    .replace(/href="\/login"/g, 'href="mailto:hello@woodwardsoftware.com?subject=WSS%20Launch%20beta"')
    // checkout buttons → pricing stays informational
    .replace(/<form method="post" action="\/api\/checkout">([\s\S]*?)<button([^>]*)type="submit"[^>]*>([\s\S]*?)<\/button>([\s\S]*?)<\/form>/g,
      '<a class="btn" href="mailto:hello@woodwardsoftware.com?subject=WSS%20Launch%20beta">$3</a>');
}

for (const route of ROUTES) {
  const res = await fetch(`${BASE}${route}`);
  if (!res.ok) { console.error(`✗ ${route} → ${res.status}`); continue; }
  const html = staticize(await res.text());
  const dir = path.join(OUT, route === "/" ? "" : route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), html);
  console.log(`✓ ${route}`);
}
for (const f of FILES) {
  const res = await fetch(`${BASE}${f}`);
  if (!res.ok) continue;
  writeFileSync(path.join(OUT, f.slice(1)), Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${f}`);
}
// demo sites (already noindexed + fictional-labeled)
const demoSrc = path.join(process.env.SITEFORGE_DATA_DIR, "demo-sites");
if (existsSync(demoSrc)) { cpSync(demoSrc, path.join(OUT, "demo"), { recursive: true }); console.log("✓ demo sites copied"); }
writeFileSync(path.join(OUT, "404.html"), staticize(await (await fetch(`${BASE}/definitely-missing`)).text()));

server.closeAllConnections?.(); server.close();
console.log(`\nStatic bundle → ${OUT}`);
process.exit(0);
