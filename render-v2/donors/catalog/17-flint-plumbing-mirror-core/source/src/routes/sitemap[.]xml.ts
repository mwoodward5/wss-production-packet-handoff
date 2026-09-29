/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: sitemap.xml — home + one URL per service area.
 * │ WHO WRITES IT: nobody. The URL shape comes from
 * │   clientConfig.vertical.nearMeSlug and trustConfig.location.serviceAreas[].
 * └──────────────────────────────────────────────────────────────────────────
 */
import { createFileRoute } from "@tanstack/react-router";

import { clientConfig } from "@/client.config";
import { allNearMePaths } from "@/lib/areas";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const base = clientConfig.canonicalUrl.replace(/\/$/, "");
        const today = new Date().toISOString().slice(0, 10);
        const urls = [`${base}/`, ...allNearMePaths().map((p) => `${base}${p}`)];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`,
  )
  .join("\n")}
</urlset>`;
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
