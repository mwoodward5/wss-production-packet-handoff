import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalMediaIdentity,
  hasUsablePhotoDimensions,
  isBannedProspectMedia,
  perceptualHashesCollide,
  prepareMediaCatalog,
} from "../lib/media-intelligence.mjs";
import { scrape } from "./02-scrape.mjs";

function png(width, height, marker = 0) {
  const buffer = Buffer.alloc(40);
  buffer.write("\x89PNG\r\n\x1a\n", 0, "binary");
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[31] = marker;
  return buffer;
}

test("B6 ban policy rejects avatar services, stock avatars, and placeholders", () => {
  const banned = [
    "https://randomuser.me/api/portraits/men/1.jpg",
    "https://i.pravatar.cc/800",
    "https://secure.gravatar.com/avatar/deadbeef",
    "https://cdn.example.test/photos/placeholder.jpg",
  ];
  for (const url of banned) assert.equal(isBannedProspectMedia({ kind: "photo", url }), true, url);
  assert.equal(isBannedProspectMedia({ kind: "photo", url: "https://cdn.example.test/team.jpg", role: "stock-avatar" }), true);
  assert.equal(isBannedProspectMedia({ kind: "photo", url: "https://cdn.example.test/projects/roof-repair.jpg" }), false);
});

test("B6 dimensions, URL identity, and perceptual collision contracts are deterministic", () => {
  assert.equal(hasUsablePhotoDimensions(1200, 800), true);
  assert.equal(hasUsablePhotoDimensions(639, 800), false);
  assert.equal(hasUsablePhotoDimensions(1200, 319), false);
  assert.equal(hasUsablePhotoDimensions(640, 320), false);
  assert.equal(
    canonicalMediaIdentity("https://cdn.example.test/job.jpg?w=1600&q=80"),
    canonicalMediaIdentity("https://cdn.example.test/job.jpg?w=900&fit=crop"),
  );
  assert.equal(perceptualHashesCollide("0000000000000000", "0000000000000001"), true);
  assert.equal(perceptualHashesCollide("0000000000000000", "ffffffffffffffff"), false);
});

test("B6 scrape mirrors verified prospect photos and rejects URL, content, perceptual, and size collisions", async () => {
  const mediaDir = mkdtempSync(path.join(tmpdir(), "siteforge-b6-media-"));
  const calls = [];
  const payloads = new Map([
    ["https://prospect.example/project-a.png?w=1600", png(1200, 800, 1)],
    ["https://prospect.example/project-b.png", png(1200, 800, 2)],
    ["https://prospect.example/project-c.png", png(1600, 1000, 3)],
    ["https://prospect.example/tiny.png", png(320, 200, 4)],
  ]);
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const body = payloads.get(String(url));
    if (!body) throw new Error(`Unexpected network request: ${url}`);
    return new Response(body, {
      status: 200,
      headers: {
        "content-length": String(body.length),
        "content-type": "image/png",
      },
    });
  };
  const packet = {
    slug: "prospect-media-proof",
    enrichment_sources: {
      branding: {
        value: {
          images: {
            gallery: [
              "https://randomuser.me/api/portraits/men/1.jpg",
              "https://i.pravatar.cc/800",
              "https://secure.gravatar.com/avatar/deadbeef",
              "https://prospect.example/placeholder.png",
              "https://prospect.example/project-a.png?w=1600",
              "https://prospect.example/project-a.png?w=900&q=70",
              "https://prospect.example/project-b.png",
              "https://prospect.example/project-c.png",
              "https://prospect.example/tiny.png",
            ],
          },
        },
      },
    },
  };

  try {
    await scrape(packet, {
      fetchImpl,
      mediaDir,
      mirrorRemote: true,
      perceptualHash: async (buffer) => buffer[31] === 3 ? "ffffffffffffffff" : "0000000000000000",
    });
    assert.equal(calls.length, 4);
    assert.equal(packet.media.catalog.length, 2);
    assert.deepEqual(packet.media.catalog.map((asset) => asset.url), [
      "https://prospect.example/project-a.png?w=1600",
      "https://prospect.example/project-c.png",
    ]);
    for (const asset of packet.media.catalog) {
      assert.equal(asset.meta.mirror_status, "owned-local");
      assert.equal(existsSync(asset.local_path), true);
      assert.deepEqual(readFileSync(asset.local_path), payloads.get(asset.url));
      assert.equal(hasUsablePhotoDimensions(asset.width, asset.height), true);
      assert.match(asset.meta.checksum_sha256, /^[a-f0-9]{64}$/);
    }
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("B6 media preparation fails closed on unverified prospect dimensions and near-duplicate photos", () => {
  const catalog = prepareMediaCatalog({
    business: { category: "roofing" },
    media: {
      catalog: [
        {
          kind: "photo",
          url: "https://prospect.example/project-a.jpg?w=1600",
          label: "Roof replacement project",
          role: "project-gallery",
          source: "business-site",
          width: 1600,
          height: 1000,
          meta: { perceptual_hash: "0000000000000000" },
        },
        {
          kind: "photo",
          url: "https://prospect.example/project-b.jpg",
          label: "Roof replacement project",
          role: "project-gallery",
          source: "business-site",
          width: 1200,
          height: 800,
          meta: { perceptual_hash: "0000000000000001" },
        },
        {
          kind: "photo",
          url: "https://prospect.example/no-dimensions.jpg",
          label: "Roof project",
          role: "project-gallery",
          source: "business-site",
        },
        {
          kind: "photo",
          url: "https://prospect.example/tiny.jpg",
          label: "Roof project",
          role: "project-gallery",
          source: "business-site",
          width: 500,
          height: 400,
        },
        {
          kind: "photo",
          url: "https://randomuser.me/api/portraits/women/1.jpg",
          label: "Roof project",
          role: "project-gallery",
          source: "business-site",
          width: 1200,
          height: 800,
        },
        {
          kind: "photo",
          url: "https://images.unsplash.com/photo-1632759145351-1d592919f522?w=1800",
          label: "Roofing editorial ambiance — not customer job proof",
          role: "supporting-ambiance",
          source: "stock-ambiance",
        },
      ],
    },
  });
  assert.equal(catalog.length, 2);
  assert.ok(catalog.some((asset) => asset.url.includes("project-a")));
  assert.ok(catalog.some((asset) => asset.source === "stock-ambiance"));
  assert.ok(catalog.every((asset) => !asset.url.includes("randomuser")));
});
