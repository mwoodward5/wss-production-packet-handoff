/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: slug helpers that expand every service area into a
 * │ "/plumber/{city}" near-me landing page and into sitemap.xml.
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE FEEDS IT:
 * │   trustConfig.location.serviceAreas[] <- Firecrawl scrape of the operator's
 * │        service-area / footer city list, cross-checked against Places
 * │        Nearby town names inside serviceRadiusKm.
 * │ EFFECT: N cities in = N indexed near-me pages out. Order = nav order.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Near-me pages
 * └──────────────────────────────────────────────────────────────────────────
 */
import { clientConfig } from "@/client.config";
import { trustConfig } from "@/trust.config";

export function areaSlug(area: string): string {
  return area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function findArea(slug: string): string | undefined {
  return (trustConfig.location.serviceAreas ?? []).find((a) => areaSlug(a) === slug);
}

/**
 * The one place the near-me URL shape is built. Trade word comes from
 * clientConfig.vertical.nearMeSlug, so nothing else in the repo hardcodes
 * "/plumber/". Used by the route, the nav, sitemap.xml and JSON-LD.
 */
export function nearMePath(slug: string): string {
  return `/${clientConfig.vertical.nearMeSlug}/${slug}`;
}

/** Every near-me URL for this client, in nav/sitemap order. */
export function allNearMePaths(): string[] {
  return (trustConfig.location.serviceAreas ?? []).map((a) => nearMePath(areaSlug(a)));
}

