// Pipeline stage 1 — discover: run Firecrawl + GBP + local SERP to build the
// initial enrichment_sources map. Emits status events for the console SSE.
import { emit } from "../lib/emit.mjs";

function unwrapFirecrawlData(response) {
  if (
    response?.data
    && typeof response.data === "object"
    && !Array.isArray(response.data)
  ) {
    return response.data;
  }
  return response;
}

export function normalizeFirecrawlBrandColors(colors) {
  const colorValues = (value) => {
    if (Array.isArray(value)) {
      return value.flatMap(colorValues);
    }
    if (value && typeof value === "object") {
      return Object.values(value).flatMap(colorValues);
    }
    if (typeof value !== "string") return [];

    const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return [];
    const digits = match[1].length === 3
      ? [...match[1]].map((digit) => `${digit}${digit}`).join("")
      : match[1];
    return [`#${digits.toUpperCase()}`];
  };

  if (Array.isArray(colors)) {
    return [...new Set(colorValues(colors))];
  }
  if (colors && typeof colors === "object") {
    const normalized = {};
    const seen = new Set();
    for (const [role, value] of Object.entries(colors)) {
      const color = colorValues(value).find((candidate) => !seen.has(candidate));
      if (!color) continue;
      seen.add(color);
      normalized[role] = color;
    }
    return normalized;
  }
  return colorValues(colors)[0];
}

function normalizeFirecrawlBranding(branding) {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) return branding;
  if (!Object.hasOwn(branding, "colors")) return { ...branding };
  return {
    ...branding,
    colors: normalizeFirecrawlBrandColors(branding.colors),
  };
}

export async function discover(packet, { firecrawlKey, gbpEnabled, serpEnabled }) {
  emit("discover", "start", { slug: packet.slug });
  const sources = packet.enrichment_sources ?? {};

  // Firecrawl branding + content
  if (packet.business.current_website && firecrawlKey) {
    emit("discover", "firecrawl", { url: packet.business.current_website });
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url: packet.business.current_website,
        formats: ["markdown", "branding", "links", { type: "summary" }],
        onlyMainContent: true,
      }),
    });
    if (r.ok) {
      const data = unwrapFirecrawlData(await r.json());
      const branding = normalizeFirecrawlBranding(data?.branding);
      sources.branding = { source: "firecrawl-branding", confidence: 0.85, value: branding };
      sources.copy = { source: "firecrawl", confidence: 0.9, value: data.markdown };
      if (branding?.logo) {
        sources.logo = { source: "firecrawl-branding", confidence: 0.9, value: branding.logo };
      }
    } else {
      emit("discover", "firecrawl-error", { status: r.status });
    }
  }

  // GBP — user-supplied URL parse (public info only). Real GBP API requires
  // operator OAuth; when absent, we scrape the public page via Firecrawl.
  if (packet.business.gbp_url && gbpEnabled && firecrawlKey) {
    emit("discover", "gbp", { url: packet.business.gbp_url });
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url: packet.business.gbp_url,
        formats: ["markdown", "links"],
        onlyMainContent: false,
      }),
    });
    if (r.ok) {
      const data = unwrapFirecrawlData(await r.json());
      sources.gbp_raw = { source: "gbp", confidence: 0.95, value: data.markdown };
    }
  }

  // Local SERP — top 5 local competitors for name+city (used for
  // differentiation cues, not copied). Optional.
  if (serpEnabled && firecrawlKey) {
    emit("discover", "serp", {});
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        query: `${packet.business.category} ${packet.business.city} ${packet.business.state}`,
        limit: 5,
      }),
    });
    if (r.ok) {
      sources.serp = { source: "serp", confidence: 0.7, value: await r.json() };
    }
  }

  packet.enrichment_sources = sources;
  emit("discover", "done", { sources: Object.keys(sources) });
  return packet;
}
