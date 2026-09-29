/**
 * Dynamic sitemap.xml — DEUCES 5-page site.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SEO } from "@/config";

interface Entry { path: string; changefreq?: string; priority?: string; lastmod?: string; }

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const base = SEO.baseUrl.replace(/\/+$/, "");
        const entries: Entry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/excavation", changefreq: "monthly", priority: "0.9" },
          { path: "/landscaping", changefreq: "monthly", priority: "0.9" },
          { path: "/storm-cleanup", changefreq: "monthly", priority: "0.9" },
          { path: "/remodeling", changefreq: "monthly", priority: "0.9" },
        ];

        const urls = entries.map((e) => [
          `  <url>`,
          `    <loc>${base}${e.path}</loc>`,
          e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
          e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
          e.priority ? `    <priority>${e.priority}</priority>` : null,
          `  </url>`,
        ].filter(Boolean).join("\n"));

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
