import assert from "node:assert/strict";
import test from "node:test";

import { compileFromInput } from "../lib/intake-genie.mjs";

test("compileFromInput preserves harvested image and navigation inventories in remix_packet", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "integration-test-key";

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  });

  const website = "https://inventory-preservation.example/";
  const servicesPage = `${website}services`;
  const photo = "https://cdn.inventory-preservation.example/crew.webp";

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/map")) {
      return new Response(JSON.stringify({
        success: true,
        links: [servicesPage, `${website}contact`, `${website}crew.pdf`],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.endsWith("/scrape")) {
      const request = JSON.parse(String(options.body || "{}"));
      const pageUrl = request.url || website;
      return new Response(JSON.stringify({
        success: true,
        data: {
          markdown: "Inventory Preservation Landscaping serves Sacramento. Landscape design and installation.",
          links: [servicesPage, `${website}contact`],
          images: [{ url: photo, alt: "Landscape crew at work" }],
          rawHtml: `<img src="${photo}" alt="Landscape crew at work">`,
          metadata: { title: "Inventory Preservation Landscaping", sourceURL: pageUrl },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target === photo) {
      return new Response(new Uint8Array(), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "0" },
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  const result = await compileFromInput({
    request_id: "remix-inventory-integration",
    website_url: website,
    name: "Inventory Preservation Landscaping",
    city: "Sacramento",
    state: "CA",
    category: "landscaping",
    services: ["Landscape design", "Landscape installation"],
    requirements: {
      site_type: "local-business",
      template_id: "authority-editorial",
      execution_mode: "review-first",
      page_plan: ["Home", "Services", "Contact"],
    },
    build_preview: false,
    dry_run: true,
  });

  assert.equal(result.ok, true);
  assert.ok(result.remix_packet, "compile must return the additive remix packet");
  assert.ok(
    result.remix_packet.media_inventory.some((item) => item.url === photo),
    "harvested first-party image inventory must survive the compile boundary",
  );
  assert.ok(
    result.remix_packet.navigation_pages.some((item) => item.url === servicesPage),
    "harvested same-site navigation must survive the compile boundary",
  );
});
