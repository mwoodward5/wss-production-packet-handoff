import { seoPages } from "../src/data/seoPages";

const BASE_URL = "https://mattressfurnitureoutletri.com";

function priorityFor(p: any): string {
  if (p.path === "/") return "1.0";
  if (p.path === "/mattresses" || p.path === "/furniture") return "0.9";
  if (p.path === "/service-area") return "0.9";
  if (p.type === "location" || p.type === "near_me") return "0.85";
  if (p.type === "category") return "0.8";
  if (p.type === "guide") return "0.7";
  if (p.path === "/guides" || p.path === "/locations") return "0.7";
  return "0.5";
}
function cf(p: any): string {
  if (p.type === "guide") return "monthly";
  if (p.type === "category" || p.type === "location" || p.type === "near_me") return "weekly";
  return "monthly";
}

const byPath = new Map<string, any>();
for (const p of seoPages) byPath.set(p.path, p);
const sorted = [...byPath.values()].sort((a, b) => parseFloat(priorityFor(b)) - parseFloat(priorityFor(a)));

const today = new Date().toISOString().slice(0, 10);
const urls = sorted
  .map(
    (p) =>
      `  <url><loc>${BASE_URL}${p.path === "/" ? "" : p.path}</loc><lastmod>${today}</lastmod><changefreq>${cf(p)}</changefreq><priority>${priorityFor(p)}</priority></url>`,
  )
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
await Bun.write("public/sitemap.xml", xml);
console.log(`Wrote ${sorted.length} URLs to public/sitemap.xml`);
