import { BUSINESS } from "@/lib/business";

/**
 * Maps a free-text project keyword to one of our 4 core service slugs.
 * Used by the homepage Project Router and any future intake forms so that
 * inbound leads always land on a verified service page.
 *
 * Returns null when the keyword doesn't map cleanly — caller should fall
 * back to /services (the index) rather than guessing.
 */
export type ServiceSlug = (typeof BUSINESS.services)[number]["slug"];

const KEYWORD_MAP: Record<string, ServiceSlug> = {
  paint: "painting",
  painting: "painting",
  interior: "painting",
  exterior: "painting",
  drywall: "drywall",
  plaster: "drywall",
  patch: "drywall",
  door: "doors-windows",
  doors: "doors-windows",
  window: "doors-windows",
  windows: "doors-windows",
  floor: "flooring",
  flooring: "flooring",
  laminate: "flooring",
  vinyl: "flooring",
  hardwood: "flooring",
};

export function routeServiceKeyword(input: string): ServiceSlug | null {
  const k = input.trim().toLowerCase();
  if (!k) return null;
  if (KEYWORD_MAP[k]) return KEYWORD_MAP[k];
  for (const [needle, slug] of Object.entries(KEYWORD_MAP)) {
    if (k.includes(needle)) return slug;
  }
  return null;
}

export function serviceHrefFor(input: string): string {
  const slug = routeServiceKeyword(input);
  return slug ? `/services/${slug}` : "/services";
}
