import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  cleanupMirroredMedia,
  createPinnedLookup,
  fetchRemotePhoto,
  isPublicIpAddress,
  mirrorProspectPhotos,
  parseRemoteHttpUrl,
  resolvePublicMediaTarget,
  scrape,
} from "./02-scrape.mjs";

function headerOnlyPng(width, height) {
  const buffer = Buffer.alloc(40);
  buffer.write("\x89PNG\r\n\x1a\n", 0, "binary");
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function imageResponse(body, contentType = "image/png") {
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(body.length),
      "content-type": contentType,
    },
  });
}

test("B6 SSRF policy rejects private, reserved, alternate IPv4, and non-global IPv6 targets", () => {
  const blockedUrls = [
    "http://127.1/photo.png",
    "http://2130706433/photo.png",
    "http://0x7f000001/photo.png",
    "http://0177.0.0.1/photo.png",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/photo.png",
    "http://192.0.2.1/photo.png",
    "http://198.51.100.1/photo.png",
    "http://203.0.113.1/photo.png",
    "http://[::1]/photo.png",
    "http://[::ffff:127.0.0.1]/photo.png",
    "http://[64:ff9b::7f00:1]/photo.png",
    "http://[2001:db8::1]/photo.png",
    "http://[2002:7f00:1::]/photo.png",
    "http://[fc00::1]/photo.png",
    "http://[fe80::1]/photo.png",
    "http://[ff00::1]/photo.png",
    "http://[3fff::1]/photo.png",
    "https://public.example:8443/photo.png",
  ];
  for (const url of blockedUrls) assert.equal(parseRemoteHttpUrl(url), null, url);
  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.ok(parseRemoteHttpUrl("https://cdn.public.example/photo.png"));
});

test("B6 DNS validation fails closed on private, mixed, empty, and malformed answers", async () => {
  await assert.rejects(
    resolvePublicMediaTarget("https://cdn.public.example/photo.png", {
      lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }],
    }),
    /non-public/,
  );
  await assert.rejects(
    resolvePublicMediaTarget("https://cdn.public.example/photo.png", {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "fd00::1", family: 6 },
      ],
    }),
    /non-public/,
  );
  await assert.rejects(
    resolvePublicMediaTarget("https://cdn.public.example/photo.png", { lookupImpl: async () => [] }),
    /no addresses/,
  );
  await assert.rejects(
    resolvePublicMediaTarget("https://cdn.public.example/photo.png", {
      lookupImpl: async () => [{ address: "93.184.216.34", family: 6 }],
    }),
    /non-public/,
  );
  const resolved = await resolvePublicMediaTarget("https://cdn.public.example/photo.png", {
    lookupImpl: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ],
  });
  assert.equal(resolved.addresses.length, 2);
});

test("B6 pinned lookup never performs a second resolution or accepts an unexpected host", async () => {
  const pinned = createPinnedLookup("cdn.public.example", [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ]);
  const all = await new Promise((resolve, reject) => {
    pinned("cdn.public.example", { all: true }, (error, records) => error ? reject(error) : resolve(records));
  });
  assert.deepEqual(all, [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ]);
  await assert.rejects(new Promise((resolve, reject) => {
    pinned("changed.public.example", {}, (error, address) => error ? reject(error) : resolve(address));
  }), /unexpected hostname/);
});

test("B6 redirects are manual, bounded, and each DNS hop is revalidated", async () => {
  const valid = await sharp({
    create: { width: 800, height: 500, channels: 3, background: "#8b2e1e" },
  }).png().toBuffer();
  let acceptedCalls = 0;
  const accepted = await fetchRemotePhoto("https://cdn.public.example/0", {
    fetchImpl: async (url) => {
      acceptedCalls += 1;
      const index = Number(new URL(url).pathname.slice(1));
      if (index < 5) return new Response(null, { status: 302, headers: { location: `/${index + 1}` } });
      return imageResponse(valid);
    },
  });
  assert.ok(accepted);
  assert.equal(acceptedCalls, 6);

  let rejectedCalls = 0;
  const rejected = await fetchRemotePhoto("https://cdn.public.example/0", {
    fetchImpl: async (url) => {
      rejectedCalls += 1;
      const index = Number(new URL(url).pathname.slice(1));
      return new Response(null, { status: 302, headers: { location: `/${index + 1}` } });
    },
  });
  assert.equal(rejected, null);
  assert.equal(rejectedCalls, 6);

  let privateRedirectCalls = 0;
  const privateRedirect = await fetchRemotePhoto("https://cdn.public.example/photo", {
    fetchImpl: async () => {
      privateRedirectCalls += 1;
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
    },
  });
  assert.equal(privateRedirect, null);
  assert.equal(privateRedirectCalls, 1);
});

test("B6 same-host redirects cannot rebind from a public DNS answer to a private address", async () => {
  let lookups = 0;
  let requests = 0;
  const result = await fetchRemotePhoto("https://cdn.public.example/start", {
    lookupImpl: async () => {
      lookups += 1;
      return lookups === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    },
    requestImpl: async () => {
      requests += 1;
      return {
        status: 302,
        body: null,
        header: (name) => name === "location" ? "/next" : null,
      };
    },
  });
  assert.equal(result, null);
  assert.equal(lookups, 2);
  assert.equal(requests, 1);
});

test("B6 body reads are streaming and hard-stop at the per-image byte limit", async () => {
  let arrayBufferCalled = false;
  const body = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(6, 1);
      yield Buffer.alloc(6, 2);
    },
    async arrayBuffer() {
      arrayBufferCalled = true;
      throw new Error("arrayBuffer must not be called");
    },
  };
  const result = await fetchRemotePhoto("https://cdn.public.example/oversize.png", {
    maxBytes: 10,
    fetchImpl: async () => ({
      status: 200,
      url: "",
      headers: { get: (name) => name === "content-type" ? "image/png" : null },
      body,
    }),
  });
  assert.equal(result, null);
  assert.equal(arrayBufferCalled, false);
});

test("B6 full decode rejects header-only files, MIME mismatches, and oversized dimensions", async () => {
  const fake = headerOnlyPng(1200, 800);
  assert.equal(await fetchRemotePhoto("https://cdn.public.example/fake.png", {
    fetchImpl: async () => imageResponse(fake),
  }), null);

  const validPng = await sharp({
    create: { width: 800, height: 500, channels: 3, background: "#345678" },
  }).png().toBuffer();
  assert.equal(await fetchRemotePhoto("https://cdn.public.example/wrong.jpg", {
    fetchImpl: async () => imageResponse(validPng, "image/jpeg"),
  }), null);

  const dimensionBomb = await sharp({
    create: { width: 12_001, height: 640, channels: 3, background: "#111111" },
  }).png().toBuffer();
  assert.equal(await fetchRemotePhoto("https://cdn.public.example/bomb.png", {
    fetchImpl: async () => imageResponse(dimensionBomb),
  }), null);
});

test("B6 required Sharp path emits pHash and drops exact and near-identical images without a provider", async () => {
  const mediaDir = mkdtempSync(path.join(tmpdir(), "siteforge-media-hardening-"));
  const red = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#8a2d1d" },
  }).png().toBuffer();
  const nearRed = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#8b2e1e" },
  }).png().toBuffer();
  const payloads = new Map([
    ["https://cdn.public.example/a.png", red],
    ["https://cdn.public.example/a-copy.png", red],
    ["https://cdn.public.example/a-near.png", nearRed],
  ]);
  try {
    const result = await mirrorProspectPhotos(
      [...payloads.keys()].map((url) => ({ kind: "photo", source: "business-site", url })),
      {
        mediaDir,
        fetchImpl: async (url) => imageResponse(payloads.get(String(url))),
      },
    );
    assert.equal(result.catalog.length, 1);
    assert.equal(result.rejected, 2);
    assert.equal(result.perceptualDuplicates, 1);
    assert.match(result.catalog[0].meta.perceptual_hash, /^[a-f0-9]{16}$/);
    assert.equal(existsSync(result.catalog[0].local_path), true);
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("B6 one-shot scrape mirrors are explicitly removable", async () => {
  const valid = await sharp({
    create: { width: 800, height: 500, channels: 3, background: "#274a32" },
  }).png().toBuffer();
  const packet = {
    slug: "cleanup-proof",
    media: {
      catalog: [{ kind: "photo", source: "business-site", url: "https://cdn.public.example/cleanup.png" }],
    },
  };
  await scrape(packet, {
    mirrorRemote: true,
    fetchImpl: async () => imageResponse(valid),
  });
  assert.equal(packet.media.mirror_cleanup_required, true);
  assert.equal(existsSync(packet.media.mirror_dir), true);
  assert.equal(cleanupMirroredMedia(packet), true);
  assert.equal(existsSync(packet.media.mirror_dir), false);
});
