import { createServerFn } from "@tanstack/react-start";

/**
 * Public, unauthenticated read of the live review/rating tables.
 * Safe for SSR and prerender: no bearer token, no admin client, RLS-gated
 * public SELECT policies only.
 */
export const getLiveProof = createServerFn({ method: "GET" })
  .inputValidator((data: { siteKey: string }) => data)
  .handler(async ({ data }) => {
    const { loadLiveProof, emptyLiveProof } = await import("./live-proof.server");
    try {
      return await loadLiveProof(data.siteKey);
    } catch (error) {
      console.error("getLiveProof failed", error);
      return emptyLiveProof;
    }
  });
