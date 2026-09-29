/**
 * IndexNow key verification file — served at /{key}.txt.
 * IndexNow requires the file body to equal the key.
 * Implementation: any /something.txt route where {key} == SEO.indexnowKey returns the key.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SEO } from "@/config";

export const Route = createFileRoute("/indexnow-key/$key.txt")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = (params as Record<string, string>)["key"] ?? (params as Record<string, string>)["key.txt"];
        if (!SEO.indexnowKey || key !== SEO.indexnowKey) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(SEO.indexnowKey, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
