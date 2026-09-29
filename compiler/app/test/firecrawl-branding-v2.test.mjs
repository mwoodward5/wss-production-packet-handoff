import assert from "node:assert/strict";
import test from "node:test";

import { onEmit } from "../../factory/lib/emit.mjs";
import {
  discover,
  normalizeFirecrawlBrandColors,
} from "../../factory/pipeline/01-discover.mjs";
import { buildVeoPrompt } from "../../asset-pipeline/veo-prompt.mjs";

test("normalizes Firecrawl colors without erasing semantic branding roles", () => {
  assert.deepEqual(normalizeFirecrawlBrandColors({
    primary: "#abc",
    secondary: ["#AABBCC", "#123456", "rgb(1, 2, 3)"],
    accent: {
      preferred: "#dE7800",
      alpha: "#12345678",
    },
    background: "#fff",
    invalid: "navy",
  }), {
    primary: "#AABBCC",
    secondary: "#123456",
    accent: "#DE7800",
    background: "#FFFFFF",
  });

  assert.deepEqual(
    normalizeFirecrawlBrandColors(["#abc", "#AABBCC", "#123456", "navy"]),
    ["#AABBCC", "#123456"],
  );
});

test("unwraps Firecrawl v2 scrape data while preserving branding, logo, and markdown", async () => {
  const originalFetch = globalThis.fetch;
  const packet = {
    slug: "firecrawl-v2",
    business: {
      current_website: "https://landscape.example",
      gbp_url: "https://maps.example/place",
    },
  };

  onEmit(() => {});
  globalThis.fetch = async (_url, options) => {
    const { url } = JSON.parse(options.body);
    if (url === packet.business.current_website) {
      return Response.json({
        success: true,
        data: {
          markdown: "# Landscape Example\nTrusted local landscape work.",
          branding: {
            logo: "https://landscape.example/logo.svg",
            colorScheme: "light",
            colors: {
              primary: "#1a2",
              secondary: ["#11AA22", "#445566", "not-a-color"],
              accent: { hex: "#dE7800" },
            },
          },
        },
      });
    }
    return Response.json({
      success: true,
      data: {
        markdown: "Landscape Example\n4.9 stars\nClovis, California",
        links: ["https://landscape.example"],
      },
    });
  };

  try {
    const result = await discover(packet, {
      firecrawlKey: "test-key",
      gbpEnabled: true,
      serpEnabled: false,
    });

    assert.deepEqual(result.enrichment_sources.branding.value, {
      logo: "https://landscape.example/logo.svg",
      colorScheme: "light",
      colors: {
        primary: "#11AA22",
        secondary: "#445566",
        accent: "#DE7800",
      },
    });
    assert.equal(result.enrichment_sources.branding.value.colors.primary, "#11AA22");
    assert.equal(result.enrichment_sources.branding.value.colors.secondary, "#445566");
    assert.equal(result.enrichment_sources.branding.value.colors.accent, "#DE7800");
    assert.equal(
      result.enrichment_sources.copy.value,
      "# Landscape Example\nTrusted local landscape work.",
    );
    assert.equal(
      result.enrichment_sources.logo.value,
      "https://landscape.example/logo.svg",
    );
    assert.equal(
      result.enrichment_sources.gbp_raw.value,
      "Landscape Example\n4.9 stars\nClovis, California",
    );

    const veo = buildVeoPrompt({
      ...result,
      business: {
        ...result.business,
        name: "Landscape Example",
        category: "landscape",
        city: "Clovis",
        state: "CA",
      },
      motif: "layered garden terraces",
      voice_persona: {},
      layout_seed: 42,
    });
    assert.match(
      veo.prompt,
      /Palette: primary #11AA22, secondary #445566, accent #DE7800\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
    onEmit(null);
  }
});
