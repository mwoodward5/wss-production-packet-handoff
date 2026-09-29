import test from "node:test";
import assert from "node:assert/strict";
import { scrape } from "../../factory/pipeline/02-scrape.mjs";
import { prepareMediaCatalog } from "../../factory/lib/media-intelligence.mjs";

test("scrape preserves enriched source and ambiance media", async () => {
  const packet = {
    media: {
      catalog: [
        { kind: "photo", url: "https://client.example/job.jpg?w=1800", source: "business-site", proof_eligible: true },
        { kind: "video", url: "media/brand-film.mp4", local_path: "C:\\media\\brand-film.mp4", mime_type: "video/mp4", source: "ai-ambiance", generated: true, proof_eligible: false },
      ],
      fallback_reason: "source video unavailable",
    },
    enrichment_sources: {
      branding: {
        value: {
          images: {
            logo: "https://client.example/logo.png",
            gallery: [
              "https://client.example/job.jpg?w=900&q=70",
              "https://client.example/job-two.jpg",
            ],
          },
        },
      },
    },
  };

  await scrape(packet, {});

  assert.equal(packet.media.fallback_reason, "source video unavailable");
  assert.equal(packet.media.catalog.length, 4);
  assert.equal(packet.media.catalog.filter((item) => item.url.includes("job.jpg")).length, 1);
  assert.ok(packet.media.catalog.some((item) => item.source === "ai-ambiance" && item.proof_eligible === false && item.local_path === "C:\\media\\brand-film.mp4" && item.mime_type === "video/mp4"));
  assert.ok(packet.media.catalog.some((item) => item.kind === "logo" && item.proof_eligible === false));
  assert.ok(packet.media.catalog.some((item) => item.url.endsWith("job-two.jpg") && item.proof_eligible === true));
});

test("catalog prep retains a local_path-only video", () => {
  const localPath = "C:\\uploads\\owner-walkthrough.ogv";
  const catalog = prepareMediaCatalog({
    business: { category: "landscaping" },
    media: { catalog: [{ local_path: localPath, source: "upload", mime_type: "video/ogg" }] },
  });

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].kind, "video");
  assert.equal(catalog[0].url, localPath);
  assert.equal(catalog[0].local_path, localPath);
  assert.equal(catalog[0].hero_eligible, true);
});
