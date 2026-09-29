import { createFileRoute } from "@tanstack/react-router";
import { CITY_SLUGS, SERVICE_SLUGS, SITE } from "@/lib/site";

const STATIC_URLS: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/services", priority: "0.9", changefreq: "monthly" },
  { path: "/projects", priority: "0.8", changefreq: "monthly" },
  { path: "/about", priority: "0.6", changefreq: "yearly" },
  { path: "/service-area", priority: "0.9", changefreq: "monthly" },
  { path: "/faq", priority: "0.6", changefreq: "monthly" },
  { path: "/contact", priority: "0.8", changefreq: "monthly" },
  { path: "/blog", priority: "0.7", changefreq: "weekly" },
];

const BLOG_SLUGS = [
  "composite-vs-wood-decking-spokane",
  "deck-permits-spokane-county",
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const base = SITE.url;
        const lastmod = new Date().toISOString().slice(0, 10);
        const all = [
          ...STATIC_URLS,
          ...SERVICE_SLUGS.map((s) => ({ path: `/services/${s}`, priority: "0.8", changefreq: "monthly" })),
          ...CITY_SLUGS.map((s) => ({ path: `/service-area/${s}`, priority: "0.8", changefreq: "monthly" })),
          ...BLOG_SLUGS.map((s) => ({ path: `/blog/${s}`, priority: "0.7", changefreq: "monthly" })),
        ];
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map((u) => `  <url><loc>${base}${u.path}</loc><lastmod>${lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>`;
        return new Response(body, { headers: { "Content-Type": "application/xml" } });
      },
    },
  },
});
