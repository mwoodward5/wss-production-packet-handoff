#!/usr/bin/env node
// Seed the template gallery: forge one clearly-fictional demo business per
// hero family, QC it, and register posters for the landing page. Resumable —
// existing demos are skipped, so it can run in chunks.
//   node app/scripts/seed-demos.mjs [--only <family>]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SITEFORGE_DATA_DIR ??= path.join(APP_ROOT, "data");
const { forgePacket } = await import("../lib/engine-adapter.mjs");
const { rescue } = await import("../../factory/pipeline/03-rescue.mjs");
const { design } = await import("../../factory/pipeline/04-design.mjs");
const { build } = await import("../../factory/pipeline/05-build-v8.mjs");
const { mergeEnrichment } = await import("../../asset-pipeline/firecrawl-gbp-merge.mjs");

const DEMOS = [
  { family: "cinematic-video-parallax", prompt: 'Site for Summit Ridge Roofing in Golden, CO. Roofing crew, storm repair, metal roofing, inspections. 18 years. "The mountain weather writes our schedule; we just answer it." Run by Dale Ferris. Direct, hardworking, honest.' },
  { family: "split-editorial-index", slug: "demo-split-editorial-index-b", prompt: 'Site for Lumen Loom Interiors in Santa Fe, NM. Interior painting and room remodeling studio: color consultations, feature walls, lighting plans. 9 years. "Every room should hold light like a story holds a reader." Luxury, refined.' },
  { family: "service-map-pins", prompt: 'Site for Harborflow Plumbing in Tacoma, WA. Plumbing services: repiping, water heaters, drain cleaning, leak detection. 14 years. "We answer the phone at 2am because pipes do not wait for morning." Family-run, friendly.' },
  { family: "material-lab-swatch", prompt: 'Site for Ironvale Excavation in Boise, ID. Excavation and grading: site prep, trenching, retaining walls, demolition. 11 years. "Dirt has opinions. We negotiate." No-nonsense, blue-collar.' },
  { family: "magazine-owner-letter", prompt: 'Site for Evergreen Putting Design in Scottsdale, AZ. Landscaping specializing in backyard putting greens, turf design, desert landscaping. 7 years. Run by Mia Torres. "A great green makes the whole yard practice patience." Warm, premium.' },
  { family: "atlas-grid-reveal", prompt: 'Site for Mesavolt Electric in Mesa, AZ. Electrical services: panel upgrades, EV chargers, lighting, solar hookups. 12 years. "Clean current, tidy conduit, no surprises on the invoice." Straight-talking.' },
];

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const outBase = path.join(APP_ROOT, "data", "demo-sites");
const demosJson = path.join(APP_ROOT, "data", "demos.json");
mkdirSync(outBase, { recursive: true });
const registry = existsSync(demosJson) ? JSON.parse(readFileSync(demosJson, "utf8")) : [];

for (const d of DEMOS) {
  if (only && d.family !== only) continue;
  const slug = d.slug || `demo-${d.family}`;
  const outDir = path.join(outBase, slug);
  if (existsSync(path.join(outDir, "index.html"))) { console.log(`· ${d.family} exists, skipping`); continue; }
  console.log(`⚒ forging demo: ${d.family}`);
  const packet = forgePacket({ prompt: d.prompt, slug, hero: d.family, demo: true });
  mkdirSync(outDir, { recursive: true });
  await rescue(packet, { lovableKey: null, outDir });
  mergeEnrichment(packet);
  design(packet);
  packet.hero_family = d.family;
  let captured = true;
  try { await build(packet, { outDir }); } catch (e) { captured = false; if (!existsSync(path.join(outDir, "index.html"))) throw e; }
  // demo guard
  const idx = path.join(outDir, "index.html");
  let html = readFileSync(idx, "utf8");
  if (!/name="robots"/.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="robots" content="noindex, nofollow" />`);
  html = html.replace(/<body([^>]*)>/i, `<body$1>\n  <!-- SiteForge demo build — fictional business, not a live company -->`);
  writeFileSync(idx, html);
  const posterPath = path.join(outDir, "screenshots", "desktop", "hero.png");
  const entry = { family: d.family, slug, url: `/demo/${slug}/`, poster: captured && existsSync(posterPath) ? `/demo/${slug}/screenshots/desktop/hero.png` : null };
  const i = registry.findIndex((r) => r.family === d.family);
  if (i >= 0) registry[i] = entry; else registry.push(entry);
  writeFileSync(demosJson, JSON.stringify(registry, null, 2));
  console.log(`  ✓ ${slug} ${captured ? "(with poster)" : "(no poster — chromium unavailable)"}`);
}
console.log(`\nRegistered ${registry.length} demo collections → app/data/demos.json`);
