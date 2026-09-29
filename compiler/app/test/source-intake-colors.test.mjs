import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSourceIntake,
  mergeSourceResults,
  normalizeSourceColors,
} from "../lib/source-intake.mjs";

test("normalizes semantic Firecrawl branding colors to deduped six-digit hex", () => {
  assert.deepEqual(normalizeSourceColors({
    primary: "#0d4a9e",
    secondary: { hex: "#337ab7", duplicate: "#0D4A9E" },
    accent: { value: ["#c0161c", "#fff"] },
    invalid: ["navy", "#12345678"],
  }), ["#0D4A9E", "#337AB7", "#C0161C", "#FFFFFF"]);
});

test("source intake preserves Firecrawl v2 semantic branding colors", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "test-key";
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/map")) {
      return Response.json({ success: true, links: [] });
    }
    if (String(url).endsWith("/scrape")) {
      return Response.json({
        success: true,
        data: {
          markdown: "Blue Diamond Plumbing serves Austin with verified plumbing services.",
          links: [],
          images: [],
          branding: {
            colors: {
              primary: "#0d4a9e",
              secondary: { hex: "#337ab7" },
              accent: { value: ["#c0161c", "#0D4A9E"] },
              background: "#fff",
            },
          },
          rawHtml: "",
          metadata: { title: "Blue Diamond Plumbing" },
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await collectSourceIntake({
      sources: { website_url: "https://blue-diamond.example" },
    }, {
      name: "Blue Diamond Plumbing",
      city: "Austin",
      state: "TX",
      category: "plumbing",
    });

    assert.deepEqual(result.found.colors, [
      "#0D4A9E",
      "#337AB7",
      "#C0161C",
      "#FFFFFF",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
});

test("source intake accepts colors only from the official website host", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "test-key";
  globalThis.fetch = async (endpoint, options = {}) => {
    if (String(endpoint).endsWith("/map")) {
      return Response.json({
        success: true,
        links: [
          "https://business.example/services",
          "https://unrelated.example/services",
        ],
      });
    }
    if (String(endpoint).endsWith("/scrape")) {
      const { url } = JSON.parse(options.body);
      const page = {
        markdown: "Acme Plumbing serves Austin with verified plumbing services.",
        links: [],
        images: [],
        rawHtml: "",
        metadata: { title: "Acme Plumbing" },
      };
      if (url === "https://business.example") {
        page.branding = {
          logo: "https://business.example/logo.svg",
          colors: { primary: "#112233" },
        };
      } else if (url === "https://business.example/services") {
        page.branding = { colors: { secondary: "#445566" } };
      } else if (url.includes("google.com")) {
        page.branding = { colors: { primary: "#4285F4" } };
      } else if (url.includes("facebook.com")) {
        page.branding = { colors: { primary: "#1877F2" } };
      } else {
        page.branding = { colors: { primary: "#DEADBE" } };
      }
      return Response.json({ success: true, data: page });
    }
    throw new Error(`Unexpected request: ${endpoint}`);
  };

  try {
    const result = await collectSourceIntake({
      sources: {
        website_url: "https://business.example",
        gbp_url: "https://www.google.com/maps/place/acme",
        social_url: "https://www.facebook.com/acme",
      },
    }, {
      name: "Acme Plumbing",
      city: "Austin",
      state: "TX",
      category: "plumbing",
    });

    assert.deepEqual(result.found.colors, ["#112233", "#445566"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
});

test("supplemental source results merge colors without duplicates", () => {
  const merged = mergeSourceResults({
    sources: ["https://business.example"],
    found: { copy: "Primary source", photos: [], colors: ["#abc", "#112233"] },
    assets: [],
    summary: { mode: "firecrawl", pages_read: 1, photos_found: 0, logo_found: false },
  }, [{
    sources: ["https://supplemental.example"],
    found: {
      copy: "Supplemental source",
      photos: [],
      colors: { primary: "#AABBCC", secondary: "#445566" },
    },
    assets: [],
    summary: { mode: "supplemental", pages_read: 1, photos_found: 0, logo_found: false },
  }]);

  assert.deepEqual(merged.found.colors, ["#AABBCC", "#112233", "#445566"]);
});
