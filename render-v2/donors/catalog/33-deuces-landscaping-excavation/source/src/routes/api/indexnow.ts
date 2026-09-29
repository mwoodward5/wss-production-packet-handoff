/**
 * POST /api/indexnow — fan-out URL submissions to IndexNow.
 * Body: { urls: string[] }
 * Requires SEO.indexnowKey to be set.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SEO } from "@/config";

const Body = z.object({
  urls: z.array(z.string().url().min(1).max(2000)).min(1).max(10000),
});

export const Route = createFileRoute("/api/indexnow")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!SEO.indexnowKey) {
          return new Response(JSON.stringify({ error: "IndexNow key not configured" }), {
            status: 501,
            headers: { "Content-Type": "application/json" },
          });
        }
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "Invalid body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const host = new URL(SEO.baseUrl).host;
        const res = await fetch("https://api.indexnow.org/IndexNow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host,
            key: SEO.indexnowKey,
            keyLocation: `${SEO.baseUrl.replace(/\/+$/, "")}/${SEO.indexnowKey}.txt`,
            urlList: parsed.data.urls,
          }),
        });
        return new Response(JSON.stringify({ ok: res.ok, status: res.status }), {
          status: res.ok ? 200 : 502,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
