export type MediaRole = "hero" | "gallery" | "people" | "about" | "logo";

type RawMedia = {
  role: MediaRole;
  path: string;
  sourceUrl: string;
  sourceSha256: string;
  outputSha256: string;
  rank: number | null;
  width: number | null;
  height: number | null;
  originalBytes: boolean;
};

type RawClientData = {
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
  }>;
  media: RawMedia[];
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
    aggregate: { rating: number; count: number; sourceUrl: string } | null;
    hours: unknown;
    areas: string[];
    socials: string[];
    badges: Array<{ label: string; sublabel: string; meta: string }>;
    stats: unknown[];
    bookingUrl: string;
    mapUrl: string;
  };
  design: {
    paletteSource: string;
    accent: string;
    fonts: string[];
  };
  trustModules: string[];
  source: {
    prospectId: string;
    compiledAt: string;
    packetSha256: string;
    packetVersion: string;
  };
};

const ROOT_ASSET = /^\/(?:assets|client)\/[A-Za-z0-9._/-]+$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function requireElement(): HTMLScriptElement {
  const node = document.getElementById("wss-client-data");
  if (!(node instanceof HTMLScriptElement) || node.type !== "application/json") {
    throw new Error("wss_client_data_island_missing");
  }
  return node;
}

function safePath(value: unknown, label: string, optional = false): string {
  if (value == null && optional) return "";
  if (typeof value !== "string" || (!value && !optional) || (value && (!ROOT_ASSET.test(value) || value.includes("..")))) {
    throw new Error("wss_client_data_path_invalid:" + label);
  }
  return value;
}

function safeText(value: unknown, label: string, min = 0, max = 4000): string {
  if (typeof value !== "string") throw new Error("wss_client_data_text_invalid:" + label);
  const out = value.trim();
  if (out.length < min || out.length > max) throw new Error("wss_client_data_text_length:" + label);
  return out;
}

function parseRaw(): RawClientData {
  const node = requireElement();
  let value: unknown;
  try {
    value = JSON.parse(node.textContent || "");
  } catch {
    throw new Error("wss_client_data_json_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("wss_client_data_object_invalid");
  const raw = value as RawClientData;
  if (raw.schema !== "wss-client-site-data-v2") throw new Error("wss_client_data_schema_invalid");
  if (!raw.identity || !raw.hero || !Array.isArray(raw.services) || !Array.isArray(raw.media) || !raw.content) {
    throw new Error("wss_client_data_shape_invalid");
  }
  safeText(raw.identity.businessName, "businessName", 2, 160);
  safeText(raw.identity.city, "city", 1, 120);
  safeText(raw.identity.state, "state", 2, 80);
  safePath(raw.identity.logoOnDark, "logoOnDark");
  safePath(raw.identity.logoOnLight, "logoOnLight");
  safePath(raw.hero.poster, "heroPoster");
  safePath(raw.hero.video, "heroVideo", true);
  if (!raw.services.length) throw new Error("wss_client_data_services_empty");
  for (const [index, service] of raw.services.entries()) {
    safeText(service.name, "serviceName" + index, 2, 140);
    safeText(service.description, "serviceDescription" + index, 20, 1800);
  }
  for (const [index, media] of raw.media.entries()) {
    safePath(media.path, "mediaPath" + index);
    if (!SHA256.test(media.sourceSha256) || !SHA256.test(media.outputSha256)) {
      throw new Error("wss_client_data_media_hash_invalid:" + index);
    }
  }
  return raw;
}

function altFor(raw: RawClientData, media: RawMedia): string {
  if (media.role === "people") return raw.identity.businessName + " team photo";
  if (media.role === "about") return raw.identity.businessName + " company photo";
  if (media.role === "hero") return raw.identity.businessName + " landscape scene";
  return raw.identity.businessName + " client photo";
}

const raw = parseRaw();
const allPhotos = raw.media
  .filter((media) => media.role !== "logo")
  .map((media) => ({
    src: media.path,
    alt: altFor(raw, media),
    sha256: media.sourceSha256,
    role: media.role,
    rank: media.rank,
    width: media.width,
    height: media.height,
  }));

export const clientData = Object.freeze({
  businessName: raw.identity.businessName,
  city: raw.identity.city,
  state: raw.identity.state,
  phoneDisplay: raw.identity.phoneDisplay,
  phoneTel: raw.identity.phoneTel,
  email: raw.identity.email,
  founded: raw.identity.founded,
  website: raw.identity.website,
  logoOnDark: raw.identity.logoOnDark,
  logoOnLight: raw.identity.logoOnLight,
  hero: raw.hero,
  services: raw.services,
  gallery: allPhotos,
  aboutPhoto: allPhotos.find((photo) => photo.role === "about") || null,
  peoplePhotos: allPhotos.filter((photo) => photo.role === "people"),
  about: raw.content.about,
  faqs: raw.content.faqs,
  values: raw.content.values,
  seasonalNote: raw.content.seasonalNote,
  serviceIntro: raw.content.serviceIntro,
  whyHeadline: raw.content.whyHeadline,
  ctaHeadline: raw.content.ctaHeadline,
  ctaBody: raw.content.ctaBody,
  trust: raw.trust,
  trustModules: raw.trustModules,
  design: raw.design,
  source: raw.source,
});

export type ClientData = typeof clientData;

export function applyVerifiedTheme(): void {
  const accent = clientData.design.accent;
  if (!accent || !/^#[0-9A-Fa-f]{6}$/.test(accent)) return;
  if (!/^verified/i.test(clientData.design.paletteSource)) return;
  // SPA donors may opt into a verified accent only. Geometry, surfaces, fonts,
  // gradients, glass opacity, and animation tokens remain donor-owned.
  document.documentElement.style.setProperty("--wss-client-accent", accent);
}


export type RichSitePlan = {
  schema: "wss-rich-site-plan-v1";
  pages: Array<{ title: string; slug: string; order: number }>;
  services: Array<{ slug: string; name: string; h1?: string; metaTitle?: string; metaDescription?: string; shortDesc?: string; longDescMd?: string; faqs?: Array<{q:string;a:string}> }>;
  content: Record<string,string>;
  forms: Record<string,unknown>;
  localPresence: Record<string,unknown>;
  search: Record<string,unknown>;
};

function parseSitePlan(): RichSitePlan | null {
  const node = document.getElementById("wss-site-plan");
  if (!(node instanceof HTMLScriptElement) || node.type !== "application/json") return null;
  const value = JSON.parse(node.textContent || "{}") as RichSitePlan;
  if (value.schema !== "wss-rich-site-plan-v1" || !Array.isArray(value.pages) || !Array.isArray(value.services)) {
    throw new Error("wss_site_plan_invalid");
  }
  return Object.freeze(value);
}

export const sitePlan = parseSitePlan();
