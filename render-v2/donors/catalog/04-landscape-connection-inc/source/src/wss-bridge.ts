import { createContext, useContext } from "react";

import { normalize } from "./client-contract.js";

export interface ClientData {
  schema: "wss-client-site-data-v2";

  identity: {
    businessName: string;
    city: string;
    state: string;
    phoneDisplay: string;
    phoneTel: string;
    email: string;
    website: string;
    founded: number | null;
    logoOnDark: string;
    logoOnLight: string;
  };

  hero: {
    line1: string;
    emphasis: string;
    line3: string;
    eyebrow: string;
    support: string;
    poster: string;
    video: string;
  };

  services: Array<{
    name: string;
    shortLabel: string;
    description: string;
    href: string;
    source: unknown;
  }>;

  media: Array<{
    role: string;
    path: string;
    rank: number | null;
    width: number;
    height: number;
    sourceSha256: string;
    outputSha256: string;
  }>;

  content: {
    serviceIntro: string;
    about: string;
    seasonalNote: string;
    whyHeadline: string;
    ctaHeadline: string;
    ctaBody: string;
    values: Array<{ title: string; body: string }>;
    faqs: Array<{ q: string; a: string }>;
  };

  trust: {
    reviews: Array<{ author: string; text: string; rating: number | null; sourceUrl: string }>;
    aggregate: { rating: number | null; count: number | null; sourceUrl: string } | null;
    hours: unknown;
    areas: string[];
    socials: string[];
    badges: Array<{ label: string; sublabel: string; meta: string }>;
    stats: unknown[];
    bookingUrl: string;
    mapUrl: string;
  };

  design: { paletteSource: string; accent: string; fonts: string[] };

  source: { prospectId: string; packetSha256: string; compiledAt: string; packetVersion: string };
}

export interface SitePlan {
  schema: "wss-rich-site-plan-v1";

  packetHash: string;

  pages: Array<{ slug?: string }>;

  content: Partial<
    Record<"home" | "services" | "gallery" | "about" | "service-area" | "contact", string>
  >;

  // The copied contract exposes these as opaque JSON: never infer factual fields.

  visual?: unknown;
  localPresence?: unknown;
  forms?: unknown;
  search?: unknown;
  premiumVisual?: unknown;
}

export interface LandscapeSite {
  client: ClientData;
  plan: SitePlan | null;
  gallery: ClientData["media"];
  emailHref: string;
  hoursText: string;
  style: Record<string, string>;
}

export function bindSite(raw: unknown, rich: unknown = null): LandscapeSite {
  const client = normalize(raw);

  let plan: SitePlan | null = null;

  if (rich !== null) {
    const p = rich as SitePlan;

    if (
      !p ||
      p.schema !== "wss-rich-site-plan-v1" ||
      !/^[a-f0-9]{64}$/i.test(p.packetHash) ||
      !Array.isArray(p.pages) ||
      !p.content ||
      typeof p.content !== "object"
    )
      throw new Error("site_plan_invalid");

    for (const value of Object.values(p.content))
      if (typeof value !== "string") throw new Error("site_plan_content_invalid");

    plan = p;
  }

  const email = client.identity.email;

  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    throw new Error("client_email_invalid");

  const style: Record<string, string> = {};

  // accent is the sole explicit palette role in CSD. Font arrays have no roles.

  if (
    !["donor-default", "approved-donor-fallback"].includes(client.design.paletteSource) &&
    /^#[0-9a-f]{6}$/i.test(client.design.accent)
  )
    style["--accent"] = client.design.accent;

  const hours = client.trust.hours as { text?: unknown; source?: unknown } | null;

  const hoursText =
    typeof hours?.text === "string" && typeof hours.source === "string" && hours.source
      ? hours.text
      : "";

  return {
    client,
    plan,
    gallery: client.media
      .filter((m) => m.role === "gallery")
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
      .slice(0, 3),
    emailHref: email ? "mailto:" + email : "",
    hoursText,
    style,
  };
}

export function readSite(doc: Pick<Document, "getElementById">): LandscapeSite {
  const data = doc.getElementById("wss-client-data");

  if (!data?.textContent) throw new Error("client_data_missing");

  const plan = doc.getElementById("wss-site-plan");

  return bindSite(
    JSON.parse(data.textContent),
    plan?.textContent ? JSON.parse(plan.textContent) : null,
  );
}

export const SiteContext = createContext<LandscapeSite | null>(null);

export function useSite(): LandscapeSite {
  const site = useContext(SiteContext);
  if (!site) throw new Error("client_data_missing");
  return site;
}

export function paragraphs(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#{1,6}\s+/gm, "").trim())
    .filter(Boolean);
}

export function resolvePage(site: LandscapeSite, path: string) {
  const clean = path.replace(/\/+$/, "") || "/";

  if (clean === "/") return { kind: "home" as const };

  const service = site.client.services.find((s) => s.href === clean);

  if (service) return { kind: "service" as const, service };

  const slug = clean.slice(1);

  if (
    ["about", "contact", "service-area", "services", "gallery"].includes(slug) &&
    site.plan?.pages.some((p) => String(p.slug || "").replace(/^\/+|\/+$/g, "") === slug)
  ) {
    const body = site.plan.content[slug as keyof SitePlan["content"]];

    if (body || ["services", "gallery", "contact"].includes(slug))
      return { kind: "planned" as const, slug, body: body || "" };
  }

  return { kind: "missing" as const };
}
