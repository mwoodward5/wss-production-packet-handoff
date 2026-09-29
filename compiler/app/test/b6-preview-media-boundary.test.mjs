import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  assignPreviewQcCohort,
  hardenPreviewMedia,
  persistPreviewQcCohort,
  withPreviewMediaCleanup,
} from "../lib/engine-adapter.mjs";
import {
  cleanupMirroredMedia,
  fetchRemoteVideo,
  verifyMirroredPhotoFile,
} from "../../factory/pipeline/02-scrape.mjs";

const ENGINE_SOURCE = fileURLToPath(new URL("../lib/engine-adapter.mjs", import.meta.url));

async function verifiedPng(width = 1000, height = 700, background = "#654321") {
  const body = await sharp({
    create: { width, height, channels: 3, background },
  }).png().toBuffer();
  const checksum = createHash("sha256").update(body).digest("hex");
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-preview-png-"));
  const file = path.join(root, "verified.png");
  writeFileSync(file, body);
  const verified = await verifyMirroredPhotoFile(file, {
    checksum_sha256: checksum,
    content_type: "image/png",
    dimensions: { width, height },
  });
  return {
    body,
    file,
    root,
    meta: {
      checksum_sha256: checksum,
      content_type: "image/png",
      dimensions: { width, height },
      perceptual_hash: verified.perceptualHash,
    },
  };
}

function imageResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(body.length),
      "content-type": "image/png",
    },
  });
}

function mp4Box(type, body = Buffer.alloc(0)) {
  const box = Buffer.alloc(8 + body.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 4, "ascii");
  body.copy(box, 8);
  return box;
}

function verifiedMp4(mediaBytes = 2048) {
  return Buffer.concat([
    mp4Box("ftyp", Buffer.from("isom\u0000\u0000\u0002\u0000isomiso2", "binary")),
    mp4Box("moov"),
    mp4Box("mdat", Buffer.alloc(mediaBytes, 3)),
  ]);
}

function videoResponse(body, {
  contentType = "video/mp4",
  contentLength = body.length,
  contentEncoding,
  status = 200,
  location,
} = {}) {
  const headers = {
    "content-length": String(contentLength),
    "content-type": contentType,
  };
  if (contentEncoding) headers["content-encoding"] = contentEncoding;
  if (location) headers.location = location;
  return new Response(body, { status, headers });
}

test("preview boundary mirrors remote prospect photos to output-owned local paths", async (t) => {
  const photo = await verifiedPng();
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-boundary-"));
  t.after(() => {
    rmSync(photo.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
  let fetches = 0;
  const packet = {
    media: {
      catalog: [{
        kind: "photo",
        url: "https://roofer.example/project.png",
        source: "business-site",
        proof_eligible: true,
      }],
    },
  };

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async () => {
      fetches += 1;
      return imageResponse(photo.body);
    },
  });

  assert.equal(fetches, 1);
  assert.equal(packet.media.catalog.length, 1);
  const [mirrored] = packet.media.catalog;
  assert.equal(mirrored.url, mirrored.local_path);
  assert.equal(path.dirname(mirrored.local_path), path.join(outDir, ".source-media-preview"));
  assert.equal(existsSync(mirrored.local_path), true);
  assert.equal(mirrored.meta.source_url, "https://roofer.example/project.png");
  assert.match(mirrored.meta.checksum_sha256, /^[a-f0-9]{64}$/);
  assert.match(mirrored.meta.perceptual_hash, /^[a-f0-9]{16}$/);
  assert.equal(cleanupMirroredMedia(packet), true);
  assert.equal(existsSync(path.join(outDir, ".source-media-preview")), false);
});

test("preview boundary preserves verified durable media without refetching it", async (t) => {
  const photo = await verifiedPng(1200, 800, "#345678");
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-hydrated-"));
  t.after(() => {
    rmSync(photo.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
  const packet = {
    media: {
      catalog: [{
        kind: "photo",
        url: "https://blob.example/source-proof.png",
        local_path: photo.file,
        source: "business-site",
        width: 1200,
        height: 800,
        meta: {
          ...photo.meta,
          mirror_status: "owned-blob",
          local_path: photo.file,
          source_url: "https://roofer.example/project.png",
        },
      }],
    },
  };

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async () => {
      throw new Error("verified local media must not be fetched");
    },
  });

  const [preserved] = packet.media.catalog;
  assert.equal(preserved.url, preserved.local_path);
  assert.notEqual(preserved.local_path, photo.file);
  assert.equal(path.dirname(preserved.local_path), path.join(outDir, ".source-media-preview"));
  assert.equal(readFileSync(preserved.local_path).equals(photo.body), true);
  assert.equal(preserved.meta.source_url, "https://roofer.example/project.png");
  cleanupMirroredMedia(packet);
});

test("trusted local uploads are fully decoded, hashed, and deduplicated before render", async (t) => {
  const photo = await verifiedPng(1200, 800, "#365a42");
  const nearDuplicate = await verifiedPng(1000, 700, "#365a42");
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-upload-"));
  t.after(() => {
    rmSync(photo.root, { recursive: true, force: true });
    rmSync(nearDuplicate.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
  const packet = {
    media: {
      catalog: [
        {
          kind: "photo",
          url: "/asset-file/project/upload-one.png",
          local_path: photo.file,
          source: "upload",
          meta: { mime: "image/png" },
        },
        {
          kind: "photo",
          url: "/asset-file/project/upload-two.png",
          local_path: photo.file,
          source: "owner-supplied",
          meta: { mime: "image/png" },
        },
        {
          kind: "photo",
          url: "/asset-file/project/upload-near-duplicate.png",
          local_path: nearDuplicate.file,
          source: "upload",
          meta: { mime: "image/png" },
        },
      ],
    },
  };

  await hardenPreviewMedia(packet, { outDir });

  assert.equal(packet.media.catalog.length, 1);
  const [verified] = packet.media.catalog;
  assert.equal(verified.url, verified.local_path);
  assert.match(verified.meta.checksum_sha256, /^[a-f0-9]{64}$/);
  assert.match(verified.meta.perceptual_hash, /^[a-f0-9]{16}$/);
  assert.equal(verified.meta.content_type, "image/png");
  assert.deepEqual(verified.meta.dimensions, { width: 1200, height: 800 });
  assert.equal(verified.meta.mirror_status, "owned-local");
  cleanupMirroredMedia(packet);
});

test("trusted local uploads reject non-image bytes and forged verification metadata", async (t) => {
  const photo = await verifiedPng(1000, 700, "#564332");
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-preview-forged-"));
  const fakePath = path.join(root, "fake.png");
  writeFileSync(fakePath, Buffer.alloc(4096, 9));
  t.after(() => {
    rmSync(photo.root, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  await assert.rejects(
    hardenPreviewMedia({
      media: {
        catalog: [{
          kind: "photo",
          url: "/asset-file/project/fake.png",
          local_path: fakePath,
          source: "upload",
          meta: { mime: "image/png" },
        }],
      },
    }, { outDir: path.join(root, "fake-out") }),
    /failed full decode/,
  );

  await assert.rejects(
    hardenPreviewMedia({
      media: {
        catalog: [{
          kind: "photo",
          url: "/asset-file/project/forged.png",
          local_path: photo.file,
          source: "owner-supplied",
          width: 9999,
          meta: {
            mime: "image/png",
            checksum_sha256: "0".repeat(64),
          },
        }],
      },
    }, { outDir: path.join(root, "forged-out") }),
    /forged or stale/,
  );
  assert.equal(existsSync(path.join(root, "fake-out", ".source-media-preview")), false);
  assert.equal(existsSync(path.join(root, "forged-out", ".source-media-preview")), false);
});

test("prospect logos are mirrored into owned output while role and provenance survive", async (t) => {
  const logoBody = await sharp({
    create: { width: 180, height: 60, channels: 4, background: "#173f5f" },
  }).png().toBuffer();
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-logo-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  let fetches = 0;
  const packet = {
    enrichment_sources: {
      logo: {
        source: "business-site",
        confidence: 0.9,
        value: "https://roofer.example/brand-logo.png",
      },
    },
    v7_logo: {
      url: "https://roofer.example/brand-logo.png",
      origin: "business-site",
      role: "wordmark",
      proposed: false,
    },
    media: { catalog: [] },
  };

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async () => {
      fetches += 1;
      return imageResponse(logoBody);
    },
  });

  assert.equal(fetches, 1);
  assert.equal(packet.v7_logo.url, packet.v7_logo.local_path);
  assert.equal(packet.logo_source.chosen_url, packet.v7_logo.local_path);
  assert.equal(path.dirname(packet.v7_logo.local_path), path.join(outDir, ".source-media-preview"));
  assert.equal(existsSync(packet.v7_logo.local_path), true);
  assert.equal(packet.v7_logo.role, "wordmark");
  assert.equal(packet.v7_logo.origin, "business-site");
  assert.deepEqual(packet.v7_logo.meta.dimensions, { width: 180, height: 60 });
  assert.equal(packet.v7_logo.meta.source_url, "https://roofer.example/brand-logo.png");
  assert.equal(packet.enrichment_sources.logo.value, packet.v7_logo.local_path);
  assert.equal(/^https?:/i.test(packet.v7_logo.url), false);
  assert.equal(/^https?:/i.test(packet.logo_source.chosen_url), false);
  assert.equal(/^https?:/i.test(packet.enrichment_sources.logo.value), false);
  cleanupMirroredMedia(packet);
});

test("an invalid remote prospect logo is removed instead of shipping a hotlink", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-logo-reject-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const packet = {
    enrichment_sources: {
      logo: { source: "business-site", value: "https://roofer.example/not-an-image.png" },
    },
    v7_logo: {
      url: "https://roofer.example/not-an-image.png",
      origin: "business-site",
      proposed: false,
    },
    media: { catalog: [] },
  };

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async () => imageResponse(Buffer.alloc(2048, 5)),
  });

  assert.equal(packet.v7_logo, undefined);
  assert.equal(packet.logo_source, undefined);
  assert.equal(packet.enrichment_sources.logo, undefined);
  cleanupMirroredMedia(packet);
});

test("trusted Ghost AI ambiance MP4 is verified and mirrored to content-addressed local media", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-ambiance-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const body = verifiedMp4();
  const sourceUrl = "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/wss-proof-assets/ambiance/austin-plumber-ab12.mp4";
  let fetches = 0;
  const packet = {
    media: {
      catalog: [{
        kind: "video",
        url: sourceUrl,
        source: "ai-ambiance",
        role: "ambiance",
        generated: true,
        proof_eligible: false,
        meta: {
          generator: "veo-3.1-fast",
          source_url: sourceUrl,
        },
      }, {
        kind: "video",
        url: "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/wss-proof-assets/ambiance/duplicate.mp4",
        source: "ai",
        role: "ambiance",
        generated: true,
      }],
    },
  };

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async (url, options) => {
      fetches += 1;
      assert.equal(url, sourceUrl);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Accept, "video/mp4");
      assert.equal(options.headers["Accept-Encoding"], "identity");
      return videoResponse(body);
    },
  });

  assert.equal(fetches, 1);
  assert.equal(packet.media.catalog.length, 1);
  const [mirrored] = packet.media.catalog;
  assert.equal(mirrored.kind, "video");
  assert.equal(mirrored.source, "ai-ambiance");
  assert.equal(mirrored.role, "ambiance");
  assert.equal(mirrored.generated, true);
  assert.equal(mirrored.ai_generated, true);
  assert.equal(mirrored.proof_eligible, false);
  assert.equal(mirrored.truthful_source, false);
  assert.equal(mirrored.url, mirrored.local_path);
  assert.equal(path.dirname(mirrored.local_path), path.join(outDir, ".source-media-preview"));
  assert.match(path.basename(mirrored.local_path), /^ambiance-[a-f0-9]{20}\.mp4$/);
  assert.equal(readFileSync(mirrored.local_path).equals(body), true);
  assert.equal(mirrored.meta.content_type, "video/mp4");
  assert.equal(mirrored.meta.byte_length, body.length);
  assert.equal(mirrored.meta.mirror_status, "owned-local");
  assert.match(mirrored.meta.checksum_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(packet).includes("lmniyuftrboqsgrwpwta.supabase.co"), false);
  cleanupMirroredMedia(packet);
});

test("proof photos use their full budget before a separate 25 MiB optional AI video budget", async (t) => {
  const photo = await verifiedPng(1200, 800, "#315f49");
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-proof-first-"));
  t.after(() => {
    rmSync(photo.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
  const videoBytes = 25 * 1024 * 1024;
  const ambiance = verifiedMp4(videoBytes - 40);
  assert.equal(ambiance.length, videoBytes);
  const videoUrl = "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/wss-proof-assets/ambiance/proof-first.mp4";
  const photoUrl = "https://plumber.example/real-project.png";
  const fetchOrder = [];
  const packet = {
    media: {
      catalog: [
        { kind: "video", url: videoUrl, source: "ai-ambiance", role: "ambiance" },
        { kind: "photo", url: photoUrl, source: "business-site", proof_eligible: true },
      ],
    },
  };

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async (url) => {
      fetchOrder.push(url);
      return url === photoUrl ? imageResponse(photo.body) : videoResponse(ambiance);
    },
  });

  assert.deepEqual(fetchOrder, [photoUrl, videoUrl]);
  const mirroredPhoto = packet.media.catalog.find((item) => item.kind === "photo");
  const mirroredVideo = packet.media.catalog.find((item) => item.kind === "video");
  assert.ok(mirroredPhoto);
  assert.ok(mirroredVideo);
  assert.equal(mirroredPhoto.url, mirroredPhoto.local_path);
  assert.equal(existsSync(mirroredPhoto.local_path), true);
  assert.equal(mirroredVideo.meta.byte_length, videoBytes);
  cleanupMirroredMedia(packet);
});

test("remote video boundary ignores untrusted candidates and attempts only the first eligible clip", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-ambiance-reject-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const trustedPrefix = "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/wss-proof-assets/ambiance/";
  const packet = {
    media: {
      catalog: [
        { kind: "video", url: "https://evil.example/storage/v1/object/public/wss-proof-assets/ambiance/evil.mp4", source: "ai-ambiance", role: "ambiance" },
        { kind: "video", url: "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/other/ambiance/evil.mp4", source: "ai-ambiance", role: "ambiance" },
        { kind: "video", url: `${trustedPrefix}source-video.mp4`, source: "business-site", role: "ambiance" },
        { kind: "video", url: `${trustedPrefix}wrong-role.mp4`, source: "ai-ambiance", role: "hero" },
        { kind: "video", url: `${trustedPrefix}redirect.mp4`, source: "ai-ambiance", role: "ambiance" },
        { kind: "video", url: `${trustedPrefix}would-succeed.mp4`, source: "ai", role: "ambiance" },
      ],
    },
  };
  const fetched = [];

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async (url) => {
      fetched.push(url);
      if (url.endsWith("/redirect.mp4")) {
        return videoResponse(null, {
          status: 302,
          contentLength: 0,
          location: "https://cdn.example/escaped.mp4",
        });
      }
      return videoResponse(verifiedMp4());
    },
  });

  assert.deepEqual(packet.media.catalog, []);
  assert.deepEqual(fetched.map((url) => path.basename(new URL(url).pathname)), [
    "redirect.mp4",
  ]);
  assert.equal(fetched.some((url) => url.includes("cdn.example")), false);
  assert.equal(existsSync(path.join(outDir, ".source-media-preview")), false);
});

test("post-harden cleanup removes an ambiance mirror and a retry drops its stale local path", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-video-retry-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const packet = {
    media: {
      catalog: [{
        kind: "video",
        url: "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/wss-proof-assets/ambiance/retry.mp4",
        source: "ai-ambiance",
        role: "ambiance",
      }],
    },
  };
  let mirroredPath;

  await assert.rejects(
    withPreviewMediaCleanup(packet, async () => {
      await hardenPreviewMedia(packet, {
        outDir,
        fetchImpl: async () => videoResponse(verifiedMp4()),
      });
      mirroredPath = packet.media.catalog[0].local_path;
      assert.equal(existsSync(mirroredPath), true);
      throw new Error("persist failed after video hardening");
    }),
    /persist failed after video hardening/,
  );
  assert.equal(existsSync(mirroredPath), false);

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async () => {
      throw new Error("stale local video must not refetch or survive");
    },
  });
  assert.deepEqual(packet.media.catalog, []);
});

test("verified video fetch streams within limits and fails closed without an origin policy", async () => {
  const url = "https://media.example/ambiance.mp4";
  assert.equal(await fetchRemoteVideo(url, {
    fetchImpl: async () => videoResponse(verifiedMp4()),
  }), null);
  for (const response of [
    videoResponse(verifiedMp4(), { contentLength: 25 * 1024 * 1024 + 1 }),
    videoResponse(verifiedMp4(), { contentType: "image/png" }),
    videoResponse(verifiedMp4(), { contentEncoding: "gzip" }),
    videoResponse(Buffer.alloc(2048, 7)),
  ]) {
    assert.equal(await fetchRemoteVideo(url, {
      allowUrl: () => true,
      fetchImpl: async () => response,
    }), null);
  }

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
  const result = await fetchRemoteVideo(url, {
    allowUrl: () => true,
    maxBytes: 10,
    fetchImpl: async () => ({
      status: 200,
      url: "",
      headers: {
        get: (name) => name === "content-type" ? "video/mp4" : null,
      },
      body,
    }),
  });
  assert.equal(result, null);
  assert.equal(arrayBufferCalled, false);
});

test("trusted ambiance redirects revalidate DNS and fail closed on rebinding", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-video-rebind-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const firstUrl = "https://lmniyuftrboqsgrwpwta.supabase.co/storage/v1/object/public/wss-proof-assets/ambiance/start.mp4";
  let lookups = 0;
  let requests = 0;
  const packet = {
    media: {
      catalog: [{
        kind: "video",
        url: firstUrl,
        source: "ai-ambiance",
        role: "ambiance",
      }],
    },
  };

  await hardenPreviewMedia(packet, {
    outDir,
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
        header: (name) => name === "location"
          ? "/storage/v1/object/public/wss-proof-assets/ambiance/next.mp4"
          : null,
      };
    },
  });

  assert.deepEqual(packet.media.catalog, []);
  assert.equal(lookups, 2);
  assert.equal(requests, 1);
  assert.equal(existsSync(path.join(outDir, ".source-media-preview")), false);
});

test("preview boundary fails closed on undecodable photos and remote prospect video hotlinks", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-reject-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const fake = Buffer.alloc(2048, 7);
  const packet = {
    media: {
      catalog: [
        { kind: "photo", url: "https://roofer.example/fake.png", source: "business-site" },
        { kind: "video", url: "https://roofer.example/prospect.mp4", source: "business-site" },
      ],
    },
  };

  await hardenPreviewMedia(packet, {
    outDir,
    fetchImpl: async () => imageResponse(fake),
  });

  assert.deepEqual(packet.media.catalog, []);
  assert.equal(packet.media.catalog.some((item) => /^https?:/i.test(item.url)), false);
  cleanupMirroredMedia(packet);
});

test("immediate preview ownership removes mirrors when stage persistence fails after hardening", async (t) => {
  const photo = await verifiedPng(1000, 700, "#72513d");
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-preview-persist-fail-"));
  t.after(() => {
    rmSync(photo.root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
  const packet = {
    media: {
      catalog: [{
        kind: "photo",
        url: "https://roofer.example/persistence-proof.png",
        source: "business-site",
      }],
    },
  };
  const persistenceFailingStage = async (work) => {
    await work();
    assert.equal(existsSync(path.join(outDir, ".source-media-preview")), true);
    throw new Error("job-state persistence failed after stage work");
  };

  await assert.rejects(
    withPreviewMediaCleanup(packet, () =>
      persistenceFailingStage(() => hardenPreviewMedia(packet, {
        outDir,
        fetchImpl: async () => imageResponse(photo.body),
      }))),
    /job-state persistence failed/,
  );
  assert.equal(existsSync(path.join(outDir, ".source-media-preview")), false);
  assert.equal(packet.media.mirror_cleanup_required, false);
});

test("all three production preview paths invoke the exact hardened scrape boundary before design", () => {
  const source = readFileSync(ENGINE_SOURCE, "utf8");
  assert.match(source, /export async function hardenPreviewMedia[\s\S]*?await scrape\(packet,\s*\{/);
  assert.equal((source.match(/hardenPreviewMedia\(packet, \{ outDir \}\)/g) || []).length, 3);

  const immediate = source.slice(
    source.indexOf("export function startTryOn("),
    source.indexOf("export async function startTryOnStaged("),
  );
  const staged = source.slice(
    source.indexOf('if (stage === "render")'),
    source.indexOf('if (stage === "capture_desktop"'),
  );
  const freeText = source.slice(
    source.indexOf("export function startForgeFromText("),
    source.indexOf("// ---------- publish ----------"),
  );
  for (const [label, block] of [["immediate", immediate], ["staged", staged], ["free-text", freeText]]) {
    const hardenedAt = block.indexOf("hardenPreviewMedia(packet, { outDir })");
    const designedAt = block.indexOf("design(packet)");
    assert.ok(hardenedAt >= 0, `${label} path is missing hardenPreviewMedia`);
    assert.ok(designedAt > hardenedAt, `${label} path designs before media hardening`);
  }
  assert.match(
    immediate,
    /withPreviewMediaCleanup\(packet,\s*async \(\) => \{[\s\S]*?withJobStage\(job\.id,\s*"scrape",[\s\S]*?hardenPreviewMedia\(packet, \{ outDir \}\)/,
  );
});

test("shared batch ids are preserved while ad-hoc preview release ids stay isolated", () => {
  const shared = {
    release_id: "legacy-release",
    forge: { batch_id: "roofing-five", release_id: "legacy-forge-release" },
    business: { category: "Roofing" },
  };
  assert.deepEqual(assignPreviewQcCohort(shared, { previewKey: "one" }), {
    schema: "siteforge-preview-qc-cohort-v1",
    kind: "batch",
    id: "roofing-five",
    trade: "roofing",
  });
  assert.equal(shared.release_id, undefined);
  assert.equal(shared.forge.release_id, undefined);
  const first = { slug: "first", business: { category: "Roofing" } };
  const second = { slug: "second", business: { category: "Roofing" } };
  assignPreviewQcCohort(first, { previewKey: "first" });
  assignPreviewQcCohort(second, { previewKey: "second" });
  assert.equal(first.qc_cohort.kind, "release");
  assert.equal(second.qc_cohort.kind, "release");
  assert.notEqual(first.qc_cohort.id, second.qc_cohort.id);
});

test("rendered public packets preserve the assigned QC cohort", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-qc-cohort-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = {
    forge: { batch_id: "landscaping-three" },
    business: { category: "Landscaping" },
  };
  assignPreviewQcCohort(packet, { previewKey: "landscape-one" });
  writeFileSync(path.join(root, "packet.json"), JSON.stringify({
    schema: "public-business-v1",
    release_id: "legacy-release",
    forge: { release_id: "legacy-forge-release" },
  }));

  assert.equal(persistPreviewQcCohort(root, packet), true);
  const rendered = JSON.parse(readFileSync(path.join(root, "packet.json"), "utf8"));
  assert.deepEqual(rendered.qc_cohort, packet.qc_cohort);
  assert.equal(rendered.batch_id, "landscaping-three");
  assert.equal(rendered.release_id, undefined);
  assert.equal(rendered.forge.release_id, undefined);
});
