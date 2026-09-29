// The copied backend normalizer is the single validation authority.
// @ts-ignore -- reference-only CommonJS contract has no declaration file.
import { normalize } from "../../../WSS-CONTRACTS/contracts/client-site-data.cjs";
export interface Media {
  role: "hero" | "gallery" | "people" | "about" | "logo";
  path: string;
  rank: number | null;
  sourceUrl: string;
}
export interface Service {
  name: string;
  shortLabel: string;
  description: string;
  href: string;
  source: unknown;
}
export interface ClientData {
  schema: string;
  identity: {
    businessName: string;
    city: string;
    state: string;
    phoneDisplay: string;
    phoneTel: string;
    email: string;
    website: string;
    founded: number | null;
    logoOnLight: string;
    logoOnDark: string;
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
  services: Service[];
  media: Media[];
  content: {
    serviceIntro: string;
    about: string;
    whyHeadline: string;
    seasonalNote: string;
    ctaHeadline: string;
    ctaBody: string;
    values: { title: string; body: string }[];
    faqs: { q: string; a: string }[];
  };
  trust: {
    reviews: { author: string; text: string; rating: number | null; sourceUrl: string }[];
    aggregate: { rating: number | null; count: number | null; sourceUrl: string } | null;
    hours: unknown;
    areas: string[];
    badges: { label: string; sublabel: string; meta: string }[];
    stats: unknown[];
    socials: string[];
    bookingUrl: string;
    mapUrl: string;
  };
  design: { paletteSource: string; accent: string; fonts: string[] };
}
export interface SitePlan {
  schema: "wss-rich-site-plan-v1";
  content?: {
    home?: string;
    about?: string;
    contact?: string;
    gallery?: string;
    "service-area"?: string;
  };
  pages?: unknown[];
  services?: unknown[];
  visual?: unknown;
  localPresence?: unknown;
}
export interface Bridge {
  client: ClientData;
  plan: SitePlan | null;
  craftImage: Media | undefined;
  gallery: Media[];
  hoursText: string;
  copy: { about: string; contact: string; gallery: string; areas: string };
}
function prose(value: unknown): string {
  if (typeof value !== "string") return "";
  // Content stays React text. No raw HTML or plan-driven components are executed.
  return value
    .trim()
    .replace(/^#{1,6}[^\n]*(?:\n+|$)/, "")
    .trim();
}
const trade =
  /\b(landscap\w*|masonry|hardscap\w*|lawn|garden\w*|pavers?|patios?|concrete|pool\w*|water features?|retaining|block walls?|outdoor kitchens?|bbqs?|fireplaces?|fire pits?|foundations?|pergolas?|irrigation|trees?|fenc\w*|sod|mulch\w*|drainage|outdoor lighting)\b/i;
export function createBridge(raw: unknown, rawPlan: unknown = null): Bridge {
  const normalized = normalize(raw) as ClientData;
  const aggregate = normalized.trust.aggregate;
  const client: ClientData = {
    ...normalized,
    trust: {
      ...normalized.trust,
      aggregate: aggregate?.rating != null && aggregate.count != null ? aggregate : null,
    },
  };
  if (client.services.length > 12 || client.services.some((s) => !trade.test(s.name)))
    throw Error("donor_wrong_trade_or_capacity");
  const routes = client.services.map((s) => s.href).filter(Boolean);
  if (new Set(routes).size !== routes.length)
    throw Error("donor_service_route_collision");
  // A contact address must not inject mailto headers, recipients, or fragments.
  if (client.identity.email && !/^[a-z0-9.!$&'*+_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(client.identity.email))
    throw Error("donor_email_invalid");
  const plan = rawPlan as SitePlan | null;
  if (plan !== null && (typeof plan !== "object" || Array.isArray(plan) || plan.schema !== "wss-rich-site-plan-v1"))
    throw Error("site_plan_schema_invalid");
  if (plan?.content !== undefined) {
    if (!plan.content || typeof plan.content !== "object" || Array.isArray(plan.content))
      throw Error("site_plan_content_invalid");
    for (const key of ["home", "about", "contact", "gallery", "service-area"] as const)
      if (plan.content[key] !== undefined && typeof plan.content[key] !== "string")
        throw Error("site_plan_content_invalid");
  }
  const hours = client.trust.hours as { text?: unknown } | null;
  return {
    client,
    plan,
    craftImage:
      client.media.find((m) => m.role === "about") || client.media.find((m) => m.role === "people"),
    gallery: client.media.filter((m) => m.role === "gallery"),
    hoursText: typeof hours?.text === "string" ? hours.text : "",
    copy: {
      about: prose(plan?.content?.about) || client.content.about,
      contact: prose(plan?.content?.contact) || client.content.ctaBody,
      gallery: prose(plan?.content?.gallery),
      areas: prose(plan?.content?.["service-area"]),
    },
  };
}
export function readBridge(doc: Document): Bridge {
  const data = doc.getElementById("wss-client-data");
  if (!data?.textContent) throw Error("client_data_required");
  const plan = doc.getElementById("wss-site-plan");
  return createBridge(
    JSON.parse(data.textContent),
    plan?.textContent ? JSON.parse(plan.textContent) : null,
  );
}
export function applyBranding(client: ClientData, doc: Document) {
  const accent = client.design.accent;
  doc.documentElement.style.removeProperty("--terracotta");
  if (!/fallback|default/i.test(client.design.paletteSource) && /^#[0-9a-f]{6}$/i.test(accent))
    doc.documentElement.style.setProperty("--terracotta", accent);
  // design.fonts is an unroled array: never infer display/body roles from order.
  doc.title = client.identity.businessName;
}
