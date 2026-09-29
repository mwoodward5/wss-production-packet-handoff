/**
 * /.well-known/security.txt — security contact per RFC 9116.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CLIENT, SEO } from "@/config";

export const Route = createFileRoute("/.well-known/security.txt")({
  server: {
    handlers: {
      GET: async () => {
        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 1);
        const body = [
          `Contact: mailto:${CLIENT.email}`,
          `Expires: ${expires.toISOString()}`,
          `Preferred-Languages: en`,
          `Canonical: ${SEO.baseUrl.replace(/\/+$/, "")}/.well-known/security.txt`,
          "",
        ].join("\n");
        return new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
